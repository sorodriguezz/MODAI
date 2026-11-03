import { createHash } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { BUILTIN_TOOLS } from "@modai/contracts/agent-tools";
import { AppError } from "@modai/contracts/errors";
import { analyzePackageQuality } from "@modai/contracts/quality";
import {
  composeSchema,
  keySchema,
  memoryQuerySchema,
  memorySchema,
  parseInput,
  projectSchema,
  publishSchema,
  resolveSchema,
  runSchema,
} from "@modai/contracts/schemas";
import type { MemoryInput, PublishPackageInput, ResolveRequest, SignaturePolicy } from "@modai/contracts/types";
import {
  isAgentPackage,
  manifestIdentity,
  normalizeManifest,
  parseTemplateManifest,
  skillArchiveToPackage,
  TEMPLATE_MANIFEST,
  templateToPackage,
  writeZip,
} from "@modai/core";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { AgentService } from "../core/agent-service.js";
import { AuditService } from "../core/audit-service.js";
import {
  AuthService,
  type Identity,
  type KeyGrants,
  namespaceOf,
  type Role,
  type UserRecord,
} from "../core/auth-service.js";
import { BackupService } from "../core/backup-service.js";
import { CategoryService } from "../core/category-service.js";
import { ContextService } from "../core/context-service.js";
import { Database } from "../core/database.js";
import { DirectoryService } from "../core/directory-service.js";
import { MetricsService } from "../core/metrics-service.js";
import { PackageService } from "../core/package-service.js";
import { RunService } from "../core/run-service.js";
import { UsageService } from "../core/usage-service.js";
import { registerAdminAssets } from "./admin-assets.js";
import { registerAuthRoutes, registerSessionAuth, seedInitialAdmin } from "./auth-routes.js";

export interface AppOptions {
  databasePath: string;
  artifactDirectory: string;
  apiToken?: string;
  logger?: boolean;
  signaturePolicy?: SignaturePolicy;
  maxArtifactStorageBytes?: number;
  rateLimitMax?: number;
  workerLeaseMs?: number;
  adminDirectory?: string | false;
  publicUrl?: string;
  /** Proxy trust for client IP and protocol (rate limits, Secure cookies): true, hop count or IP/CIDR list. */
  trustProxy?: boolean | number | string;
  /** First admin for the panel; defaults to MODAI_ADMIN_USERNAME / MODAI_ADMIN_PASSWORD. `false` disables seeding. */
  initialAdmin?: { username: string; password: string } | false;
  sessionIdleMs?: number;
  sessionMaxMs?: number;
  loginRateLimitMax?: number;
  loginDelayMs?: number;
}

type AuthenticatedRequest = FastifyRequest & { modaiIdentity?: Identity };

/**
 * Validates a publish body and returns it exactly as the client sent it. The parsed copy has defaults
 * applied and keys reordered, which would break the signature and integrity computed over the original.
 */
function validatedPackage(body: unknown): PublishPackageInput {
  parseInput(publishSchema, body);
  return body as PublishPackageInput;
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  let publicUrl: string | undefined;
  if (options.publicUrl) {
    const url = new URL(options.publicUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("MODAI_PUBLIC_URL debe ser un origen HTTP(S), sin ruta ni credenciales");
    publicUrl = url.origin;
  }
  // Fastify accepts a hop count for trustProxy at runtime; its typings omit it.
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1024 * 1024,
    trustProxy: (options.trustProxy ?? false) as boolean,
  });
  const db = new Database(options.databasePath);
  const packages = new PackageService(
    db,
    options.artifactDirectory,
    options.signaturePolicy,
    options.maxArtifactStorageBytes,
  );
  const context = new ContextService(db);
  const agents = new AgentService(packages);
  const runs = new RunService(db, options.workerLeaseMs);
  const auth = new AuthService(db, options.apiToken, {
    idleMs: options.sessionIdleMs,
    absoluteMs: options.sessionMaxMs,
  });
  const usage = new UsageService(db);
  const directory = new DirectoryService(db, auth);
  const categories = new CategoryService(db);
  try {
    await seedInitialAdmin(auth, new AuditService(db), options.initialAdmin);
  } catch (error) {
    db.close();
    throw error;
  }
  if (!auth.configured()) {
    db.close();
    throw new AppError(
      500,
      "AUTH_NOT_CONFIGURED",
      "Configura MODAI_API_TOKEN, MODAI_ADMIN_USERNAME/MODAI_ADMIN_PASSWORD o una API key admin activa antes de arrancar",
    );
  }
  const audit = new AuditService(db);
  const metrics = new MetricsService();
  const backup = new BackupService(db, packages, context);

  await app.register(cors, { origin: false });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    frameguard: { action: "deny" },
  });
  await app.register(rateLimit, { max: options.rateLimitMax ?? 600, timeWindow: "1 minute" });

  const tokenFrom = (request: FastifyRequest): string | undefined => {
    const authorization = request.headers.authorization ?? "";
    return authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  };
  const identityOf = (request: FastifyRequest): Identity | undefined => (request as AuthenticatedRequest).modaiIdentity;
  const requireRole = (request: FastifyRequest, role: Role): Identity => auth.require(identityOf(request), role);
  const record = (request: FastifyRequest, action: string, resource: string, details?: unknown): void =>
    audit.record(identityOf(request)?.label ?? "anonymous", action, resource, details);

  app.addHook("onRequest", async (request) => {
    (request as AuthenticatedRequest).modaiIdentity = auth.authenticate(tokenFrom(request));
  });
  registerSessionAuth(app, auth, publicUrl);
  app.addHook("onResponse", async (request, reply) => {
    metrics.observe(request.method, request.routeOptions.url ?? request.url, reply.statusCode);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details, requestId: request.id } });
    }
    request.log.error(error);
    const generic = error as { statusCode?: number; message?: string };
    const statusCode = typeof generic?.statusCode === "number" ? generic.statusCode : 500;
    return reply.code(statusCode).send({
      error: {
        code: statusCode === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR",
        message: statusCode >= 500 ? "Error interno" : generic.message,
        requestId: request.id,
      },
    });
  });

  // Public: what a client needs to connect. The Node version is only for authenticated callers (it helps attackers, not users).
  app.get("/health", async (request) => ({
    status: "ok",
    service: "modularai",
    version: "0.10.0",
    apiVersion: 1,
    signaturePolicy: options.signaturePolicy ?? "optional",
    publicUrl,
    ...(identityOf(request) ? { runtime: process.version } : {}),
  }));
  app.get("/", async (_request, reply) => reply.redirect("/admin"));
  if (options.adminDirectory !== false) {
    try {
      registerAdminAssets(app, options.adminDirectory);
    } catch (error) {
      db.close();
      throw error;
    }
  }
  app.get("/api/v1", async (request) => {
    requireRole(request, "reader");
    return {
      name: "ModularAI API",
      version: "v1",
      resources: ["packages", "resolve", "artifacts", "knowledge", "memories", "admin", "metrics"],
      architecture: {
        server: "registry-context-and-agent-control",
        inference: "client-or-worker",
        embeddings: "client-generated",
      },
    };
  });
  app.get("/api/v1/session", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const identity = requireRole(request, "reader");
    return {
      label: identity.label,
      role: identity.role,
      projectIds: identity.projectIds,
      organizationIds: identity.organizationIds,
      packageScopes: identity.packageScopes,
      permissions: auth.permissions(identity),
    };
  });
  registerAuthRoutes(app, {
    auth,
    audit,
    publicUrl,
    loginRateLimitMax: options.loginRateLimitMax,
    loginDelayMs: options.loginDelayMs,
  });

  app.get<{ Querystring: { q?: string; type?: string; includeYanked?: string; name?: string } }>(
    "/api/v1/packages",
    async (request) => {
      const visible = auth.packageReader(identityOf(request));
      const list = packages
        .list(request.query.name ?? request.query.q, request.query.type, request.query.includeYanked === "true")
        .filter((item) => visible(item.name));
      return { packages: request.query.name ? list.filter((item) => item.name === request.query.name) : list };
    },
  );
  app.get<{
    Querystring: { q?: string; type?: string; category?: string; status?: string; limit?: string; offset?: string };
  }>("/api/v1/packages/catalog", async (request) => {
    const visible = auth.packageReader(identityOf(request));
    const { limit, offset, ...filters } = request.query;
    return packages.catalog({
      ...filters,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      visible,
    });
  });
  app.get("/api/v1/packages/summary", async (request) => {
    return packages.summary(auth.packageReader(identityOf(request)));
  });
  app.get<{ Querystring: { name: string } }>("/api/v1/packages/usage", async (request) => {
    const identity = requireRole(request, "reader");
    auth.requireReadPackage(identity, String(request.query.name ?? ""));
    const visible = new Set(auth.listProjects(identity).map((project) => project.id));
    return { projects: usage.usage(String(request.query.name ?? ""), (projectId) => visible.has(projectId)) };
  });
  app.put<{ Params: { id: string }; Body: { packages: Array<{ name: string; version: string; direct?: boolean }> } }>(
    "/api/v1/projects/:id/installations",
    {
      schema: {
        body: {
          type: "object",
          required: ["packages"],
          additionalProperties: false,
          properties: {
            packages: {
              type: "array",
              maxItems: 1000,
              items: {
                type: "object",
                required: ["name", "version"],
                additionalProperties: false,
                properties: {
                  name: {
                    type: "string",
                    minLength: 3,
                    maxLength: 214,
                    pattern: "^@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$",
                  },
                  version: { type: "string", minLength: 1, maxLength: 100 },
                  direct: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      // Any key with access to the project may report what it installed there: it is metadata, not content.
      auth.requireProject(identityOf(request), request.params.id);
      usage.report(request.params.id, request.body.packages);
      return reply.code(204).send();
    },
  );
  app.get<{ Querystring: { name: string; version?: string } }>("/api/v1/package", async (request) => {
    auth.requireReadPackage(identityOf(request), String(request.query.name ?? ""));
    return { package: packages.get(request.query.name, request.query.version) };
  });
  app.post<{ Body: PublishPackageInput }>(
    "/api/v1/packages/validate",
    { bodyLimit: 36 * 1024 * 1024, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request) => {
      requireRole(request, "publisher");
      const input = validatedPackage(request.body);
      return { quality: analyzePackageQuality(input.manifest, input.files) };
    },
  );
  app.post<{ Body: PublishPackageInput }>(
    "/api/v1/packages",
    { bodyLimit: 36 * 1024 * 1024 },
    async (request, reply) => {
      const input = validatedPackage(request.body);
      const name = manifestIdentity(input.manifest).name;
      auth.requirePublish(identityOf(request), name);
      const published = packages.publish(input);
      auth.ensureNamespace(name, identityOf(request)!);
      record(request, "package.publish", `${published.name}@${published.version}`, {
        signed: Boolean(request.body.signature),
        quality: published.quality?.score,
      });
      return reply.code(201).send({ package: published });
    },
  );
  /** `.skill` files (a ZIP with SKILL.md) become a v1 package with that skill. `dryRun` returns the preview and quality. */
  app.post<{ Body: { archive: string; namespace: string; version?: string; name?: string; dryRun?: boolean } }>(
    "/api/v1/packages/import-skill",
    {
      bodyLimit: 36 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["archive", "namespace"],
          additionalProperties: false,
          properties: {
            archive: { type: "string", minLength: 1, maxLength: 36 * 1024 * 1024 },
            namespace: { type: "string", pattern: "^@[a-z0-9][a-z0-9._-]*$" },
            version: { type: "string", maxLength: 100 },
            name: { type: "string", maxLength: 64 },
            dryRun: { type: "boolean" },
          },
        },
      },
      // Unzipping up to 25 MiB is real work: only publishers, and not in a loop.
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      requireRole(request, "publisher");
      let converted;
      try {
        converted = skillArchiveToPackage(Buffer.from(request.body.archive, "base64"), request.body);
      } catch (error) {
        throw new AppError(400, "INVALID_SKILL", (error as Error).message);
      }
      const { skill, ...input } = converted;
      const name = manifestIdentity(input.manifest).name;
      if (request.body.dryRun) {
        return {
          skill,
          name,
          manifest: input.manifest,
          files: input.files.map((file) => ({ path: file.path, size: Buffer.from(file.content, "base64").length })),
          quality: analyzePackageQuality(input.manifest, input.files),
        };
      }
      auth.requirePublish(identityOf(request), name);
      const published = packages.publish(validatedPackage(input));
      auth.ensureNamespace(name, identityOf(request)!);
      record(request, "package.publish", `${published.name}@${published.version}`, {
        source: "skill",
        quality: published.quality?.score,
      });
      return reply.code(201).send({ package: published });
    },
  );
  /** A whole starter project (ZIP or files) becomes a `kind: Template` package, used with `modai template use`. */
  app.post<{
    Body: {
      name: string;
      version: string;
      description: string;
      category?: string;
      keywords?: string[];
      declaration?: { features?: Record<string, Record<string, unknown>>; addon?: { for: string[] } };
      archive?: string;
      files?: Array<{ path: string; content: string; sha256: string }>;
    };
  }>(
    "/api/v1/packages/import-template",
    {
      bodyLimit: 36 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["name", "version", "description"],
          additionalProperties: false,
          properties: {
            name: { type: "string", maxLength: 214 },
            version: { type: "string", maxLength: 100 },
            description: { type: "string", maxLength: 5000 },
            category: { type: "string", maxLength: 64 },
            keywords: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 } },
            // The template's features (flags of `modai template use`), validated like a modai.template.yaml on publish.
            declaration: {
              type: "object",
              additionalProperties: false,
              properties: {
                features: { type: "object", maxProperties: 50, additionalProperties: { type: "object" } },
                addon: {
                  type: "object",
                  additionalProperties: false,
                  required: ["for"],
                  properties: { for: { type: "array", maxItems: 50, items: { type: "string", maxLength: 214 } } },
                },
              },
            },
            archive: { type: "string", maxLength: 36 * 1024 * 1024 },
            files: {
              type: "array",
              maxItems: 5000,
              items: {
                type: "object",
                required: ["path", "content", "sha256"],
                additionalProperties: false,
                properties: {
                  path: { type: "string", maxLength: 1024 },
                  content: { type: "string" },
                  sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { archive, files, ...options } = request.body;
      auth.requirePublish(identityOf(request), options.name);
      auth.requireNamespaceExists(options.name);
      if (!archive && !files?.length)
        throw new AppError(400, "INVALID_TEMPLATE", "Envía un ZIP (archive) o la lista de archivos");
      let input: PublishPackageInput;
      try {
        input = templateToPackage(
          archive
            ? { archive: Buffer.from(archive, "base64") }
            : { entries: files!.map((file) => ({ path: file.path, bytes: Buffer.from(file.content, "base64") })) },
          options,
        );
      } catch (error) {
        throw new AppError(400, "INVALID_TEMPLATE", (error as Error).message);
      }
      const published = packages.publish(validatedPackage(input));
      record(request, "package.publish", `${published.name}@${published.version}`, {
        source: "template",
        quality: published.quality?.score,
      });
      return reply.code(201).send({ package: published });
    },
  );
  /** Features and add-on declaration of a template version (its modai.template.yaml), plus its file list. */
  app.get<{ Querystring: { name: string; version?: string } }>("/api/v1/packages/template", async (request) => {
    auth.requireReadPackage(identityOf(request), String(request.query.name ?? ""));
    const item = packages.get(request.query.name, request.query.version);
    if (normalizeManifest(item.manifest).kind !== "Template")
      throw new AppError(400, "NOT_A_TEMPLATE", `${item.name} no es un template de proyecto`);
    const { files } = packages.getArtifact(item.artifactId);
    const declaration = files.find((file) => file.path === TEMPLATE_MANIFEST);
    let manifest: ReturnType<typeof parseTemplateManifest> & { manifestError?: string } = { features: [] };
    // A version published before a rule changed keeps working for reading; `template use` reports the problem.
    if (declaration) {
      try {
        manifest = parseTemplateManifest(Buffer.from(declaration.content, "base64").toString("utf8"));
      } catch (error) {
        manifest = { features: [], manifestError: (error as Error).message };
      }
    }
    return {
      package: item,
      ...manifest,
      files: files.map((file) => ({ path: file.path, size: Buffer.from(file.content, "base64").length })),
    };
  });
  /** Any package version as a .zip of its files (a template unpacks as its project folder). */
  app.get<{ Querystring: { name: string; version?: string } }>("/api/v1/packages/download", async (request, reply) => {
    auth.requireReadPackage(identityOf(request), String(request.query.name ?? ""));
    const item = packages.get(request.query.name, request.query.version);
    const folder = item.name.split("/")[1]!;
    const zip = writeZip(
      packages
        .getArtifact(item.artifactId)
        .files.map((file) => ({ path: `${folder}/${file.path}`, bytes: Buffer.from(file.content, "base64") })),
    );
    record(request, "package.download", `${item.name}@${item.version}`);
    return reply
      .type("application/zip")
      .header("content-disposition", `attachment; filename="${folder}-${item.version}.zip"`)
      .send(zip);
  });
  app.post<{ Body: ResolveRequest }>("/api/v1/resolve", async (request) => {
    const visible = auth.packageReader(identityOf(request));
    const input = parseInput(resolveSchema, request.body);
    for (const root of input.packages)
      if (!visible(root.name)) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${root.name}`);
    const resolved = await packages.resolve(input);
    const hidden = resolved.find((item) => !visible(item.name));
    if (hidden)
      throw new AppError(
        403,
        "PACKAGE_FORBIDDEN",
        `Una dependencia está en un namespace restringido sin acceso: ${namespaceOf(hidden.name)}`,
      );
    return { packages: resolved };
  });
  app.get<{ Params: { id: string } }>("/api/v1/artifacts/:id", async (request) => {
    const owner = packages.artifactOwner(request.params.id);
    if (owner) auth.requireReadPackage(identityOf(request), owner);
    else requireRole(request, "admin");
    return packages.getArtifact(request.params.id);
  });
  const versionRef = {
    name: { type: "string", pattern: "^@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$", maxLength: 214 },
    version: { type: "string", minLength: 1, maxLength: 100 },
  };
  app.post<{ Body: { name: string; version: string; message: string } }>(
    "/api/v1/admin/packages/deprecate",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "version", "message"],
          additionalProperties: false,
          properties: { ...versionRef, message: { type: "string", maxLength: 1000 } },
        },
      },
    },
    async (request) => {
      auth.requireManagePackage(identityOf(request), String(request.body?.name ?? ""));
      const item = packages.deprecate(request.body.name, request.body.version, request.body.message);
      record(request, "package.deprecate", `${item.name}@${item.version}`, { message: request.body.message });
      return { package: item };
    },
  );
  app.post<{ Body: { name: string; version: string; reason: string } }>(
    "/api/v1/admin/packages/yank",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "version", "reason"],
          additionalProperties: false,
          properties: { ...versionRef, reason: { type: "string", maxLength: 1000 } },
        },
      },
    },
    async (request) => {
      auth.requireManagePackage(identityOf(request), String(request.body?.name ?? ""));
      const item = packages.yank(request.body.name, request.body.version, request.body.reason);
      record(request, "package.yank", `${item.name}@${item.version}`, { reason: request.body.reason });
      return { package: item };
    },
  );
  app.delete<{ Body: { name: string; version: string; confirmation: string } }>(
    "/api/v1/admin/packages",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "version", "confirmation"],
          additionalProperties: false,
          properties: { ...versionRef, confirmation: { type: "string", maxLength: 330 } },
        },
      },
    },
    async (request, reply) => {
      requireRole(request, "admin");
      packages.hardDelete(request.body.name, request.body.version, request.body.confirmation);
      record(request, "package.delete", request.body.confirmation);
      return reply.code(204).send();
    },
  );
  app.get("/api/v1/admin/publishers", async (request) => {
    requireRole(request, "admin");
    return { publishers: packages.listPublishers() };
  });
  app.post<{ Body: { publicKey: string; label: string; trusted: boolean } }>(
    "/api/v1/admin/publishers",
    {
      schema: {
        body: {
          type: "object",
          required: ["publicKey", "label", "trusted"],
          properties: {
            publicKey: { type: "string", maxLength: 4096 },
            label: { type: "string", maxLength: 200 },
            trusted: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      requireRole(request, "admin");
      const fingerprint = packages.registerPublisher(request.body.publicKey, request.body.label, request.body.trusted);
      record(request, "publisher.register", fingerprint);
      return { fingerprint };
    },
  );
  app.patch<{ Params: { fingerprint: string }; Body: { trusted: boolean; label?: string } }>(
    "/api/v1/admin/publishers/:fingerprint",
    {
      schema: {
        body: {
          type: "object",
          required: ["trusted"],
          additionalProperties: false,
          properties: { trusted: { type: "boolean" }, label: { type: "string", maxLength: 200 } },
        },
      },
    },
    async (request) => {
      requireRole(request, "admin");
      packages.trustPublisher(request.params.fingerprint, request.body.trusted, request.body.label);
      record(request, "publisher.trust", request.params.fingerprint, request.body);
      return { ok: true };
    },
  );

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/api/v1/knowledge/documents", async (request) => {
    requireRole(request, "reader");
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(request.query.offset) || 0, 0);
    const visible = auth.packageReader(identityOf(request));
    const documents = (context.listKnowledge(limit, offset) as Array<{ packageName?: string | null }>).filter(
      (doc) => !doc.packageName || visible(doc.packageName),
    );
    return { documents, nextOffset: documents.length === limit ? offset + limit : null };
  });
  const knowledgeBody = {
    title: { type: "string", minLength: 1, maxLength: 300 },
    content: { type: "string", minLength: 1, maxLength: 1_000_000 },
    tags: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 } },
  };
  const knowledgeOwner = (id: string): string | null => {
    const doc = db.connection.prepare("SELECT package_name FROM knowledge_documents WHERE id = ?").get(id) as
      | { package_name: string | null }
      | undefined;
    if (!doc) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", "Documento no encontrado");
    return doc.package_name;
  };
  app.post<{ Body: { title: string; content: string; tags?: string[]; packageName?: string } }>(
    "/api/v1/knowledge/documents",
    {
      schema: {
        body: {
          type: "object",
          required: ["title", "content"],
          additionalProperties: false,
          properties: {
            ...knowledgeBody,
            packageName: { type: "string", pattern: "^@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$", maxLength: 214 },
          },
        },
      },
    },
    async (request, reply) => {
      auth.requireWriteKnowledge(identityOf(request), request.body.packageName);
      const document = context.addKnowledge(request.body);
      record(request, "knowledge.create", String(document.id));
      return reply.code(201).send({ document });
    },
  );
  app.patch<{ Params: { id: string }; Body: { title?: string; content?: string; tags?: string[] } }>(
    "/api/v1/knowledge/documents/:id",
    {
      schema: { body: { type: "object", additionalProperties: false, properties: knowledgeBody } },
    },
    async (request) => {
      auth.requireWriteKnowledge(identityOf(request), knowledgeOwner(request.params.id));
      const document = context.updateKnowledge(request.params.id, request.body);
      record(request, "knowledge.update", request.params.id);
      return { document };
    },
  );
  app.delete<{ Params: { id: string } }>("/api/v1/knowledge/documents/:id", async (request, reply) => {
    auth.requireWriteKnowledge(identityOf(request), knowledgeOwner(request.params.id));
    context.deleteKnowledge(request.params.id);
    record(request, "knowledge.delete", request.params.id);
    return reply.code(204).send();
  });
  app.post<{ Body: { query: string; limit?: number; packageNames?: string[] } }>(
    "/api/v1/knowledge/search",
    async (request) => {
      const visible = auth.packageReader(identityOf(request));
      return {
        results: (context.searchKnowledge(request.body) as Array<{ packageName?: string | null }>).filter(
          (doc) => !doc.packageName || visible(doc.packageName),
        ),
      };
    },
  );
  const vectorSchema = { type: "array", minItems: 1, maxItems: 8192, items: { type: "number" } };
  app.put<{ Params: { id: string }; Body: { model: string; embedding: number[]; sourceHash?: string } }>(
    "/api/v1/knowledge/documents/:id/vector",
    {
      schema: {
        body: {
          type: "object",
          required: ["model", "embedding"],
          additionalProperties: false,
          properties: {
            model: { type: "string", minLength: 1, maxLength: 200 },
            embedding: vectorSchema,
            sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          },
        },
      },
    },
    async (request) => {
      const doc = db.connection
        .prepare("SELECT title, content, package_name FROM knowledge_documents WHERE id = ?")
        .get(request.params.id) as { title: string; content: string; package_name: string | null } | undefined;
      if (!doc) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", "Documento no encontrado");
      // Vectors are computed by clients: only someone who may write the document (or index its package) replaces them.
      auth.requireWriteKnowledge(identityOf(request), doc.package_name);
      if (
        request.body.sourceHash &&
        request.body.sourceHash !==
          createHash("sha256")
            .update(doc.title + "\n" + doc.content)
            .digest("hex")
      )
        throw new AppError(409, "DOCUMENT_CHANGED", "El documento cambió durante la indexación; vuelve a indexarlo.");
      if (!request.body.embedding.some((value) => value !== 0))
        throw new AppError(400, "INVALID_VECTOR", "El vector no puede ser cero");
      context.saveVector(request.params.id, request.body.model, request.body.embedding);
      record(request, "knowledge.vector-upload", request.params.id, { model: request.body.model });
      return { ok: true };
    },
  );
  app.post<{ Body: { embedding: number[]; model: string; limit?: number; packageNames?: string[] } }>(
    "/api/v1/knowledge/vector-search",
    {
      schema: {
        body: {
          type: "object",
          required: ["model", "embedding"],
          properties: {
            model: { type: "string", minLength: 1, maxLength: 200 },
            embedding: vectorSchema,
            limit: { type: "integer", minimum: 1, maximum: 50 },
            packageNames: { type: "array", maxItems: 200, items: { type: "string" } },
          },
        },
      },
    },
    async (request) => {
      const visible = auth.packageReader(identityOf(request));
      return {
        results: (
          (await context.vectorSearchAsync(
            request.body.embedding,
            request.body.model,
            request.body.limit,
            request.body.packageNames,
          )) as Array<{ packageName?: string | null }>
        ).filter((doc) => !doc.packageName || visible(doc.packageName)),
      };
    },
  );

  app.post<{ Body: MemoryInput }>("/api/v1/memories", async (request, reply) => {
    const actor = requireRole(request, "reader");
    const input = parseInput(memorySchema, request.body);
    const project = auth.requireProject(actor, input.projectId, true);
    if (input.scope === "organization") auth.requireOrganization(actor, project.organizationId);
    if (input.scope === "session" && !input.sessionId)
      throw new AppError(400, "SESSION_REQUIRED", "sessionId es obligatorio");
    const memory = context.remember(input, actor.id, project.organizationId);
    record(request, "memory.create", String(memory.id), { projectId: input.projectId });
    return reply.code(201).send({ memory });
  });
  app.get<{ Querystring: { projectId: string; limit?: string; includeOrganization?: string; sessionId?: string } }>(
    "/api/v1/memories",
    async (request) => {
      const project = auth.requireProject(identityOf(request), request.query.projectId);
      const organizationId = request.query.includeOrganization === "true" ? project.organizationId : undefined;
      if (request.query.includeOrganization === "true") auth.requireOrganization(identityOf(request), organizationId);
      return {
        memories: context.listMemories(project.id, Number(request.query.limit) || 50, {
          organizationId,
          sessionId: request.query.sessionId,
        }),
      };
    },
  );
  app.post("/api/v1/memories/search", async (request) => {
    const input = parseInput(memoryQuerySchema, request.body);
    const project = auth.requireProject(identityOf(request), input.projectId);
    const organizationId = input.includeOrganization ? project.organizationId : undefined;
    if (input.includeOrganization) auth.requireOrganization(identityOf(request), organizationId);
    return { results: context.searchMemories({ ...input, organizationId }) };
  });
  app.patch<{ Params: { id: string } }>("/api/v1/memories/:id", async (request) => {
    requireRole(request, "reader");
    const memory = context.getMemory(request.params.id);
    auth.requireProject(identityOf(request), memory.projectId, true);
    if (memory.scope === "organization") auth.requireOrganization(identityOf(request), memory.organizationId);
    const input = parseInput(memorySchema.omit({ projectId: true, sessionId: true }).partial(), request.body);
    const updated = context.updateMemory(request.params.id, input);
    record(request, "memory.update", request.params.id);
    return { memory: updated };
  });
  app.delete<{ Params: { id: string } }>("/api/v1/memories/:id", async (request, reply) => {
    requireRole(request, "reader");
    const memory = context.getMemory(request.params.id);
    auth.requireProject(identityOf(request), memory.projectId, true);
    if (memory.scope === "organization") auth.requireOrganization(identityOf(request), memory.organizationId);
    context.deleteMemory(request.params.id);
    record(request, "memory.delete", request.params.id);
    return reply.code(204).send();
  });

  app.get("/api/v1/projects", async (request) => ({ projects: auth.listProjects(identityOf(request)) }));
  app.post("/api/v1/projects", async (request, reply) => {
    const project = auth.createProject(identityOf(request), parseInput(projectSchema, request.body));
    record(request, "project.create", project.id);
    return reply.code(201).send({ project });
  });
  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>(
    "/api/v1/projects/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["confirmation"],
          properties: { confirmation: { type: "string", maxLength: 200 } },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      if (request.body.confirmation !== request.params.id)
        throw new AppError(
          400,
          "CONFIRMATION_REQUIRED",
          "Para eliminar el proyecto, confirma escribiendo su identificador",
        );
      const result = auth.deleteProject(identityOf(request), request.params.id);
      record(request, "project.delete", request.params.id, {
        name: result.project.name,
        memories: result.memories,
        runs: result.runs,
      });
      return { deleted: result.project, memories: result.memories, runs: result.runs };
    },
  );
  app.patch<{ Params: { id: string }; Body: { name?: string; organizationId?: string | null } }>(
    "/api/v1/projects/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            organizationId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request) => {
      const project = auth.updateProject(identityOf(request), request.params.id, request.body ?? {});
      record(request, "project.update", project.id, request.body);
      return { project };
    },
  );

  const organizationBody = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 1000 },
    },
  };
  app.get("/api/v1/organizations", async (request) => ({
    organizations: directory.listOrganizations(identityOf(request)),
  }));
  const createOrganization = async (
    request: FastifyRequest<{ Body: { name: string; description?: string } }>,
    reply: FastifyReply,
  ) => {
    const organization = directory.createOrganization(identityOf(request), request.body);
    record(request, "organization.create", organization.id, { name: organization.name });
    return reply.code(201).send({ organization });
  };
  app.post(
    "/api/v1/organizations",
    { schema: { body: { ...organizationBody, required: ["name"] } } },
    createOrganization,
  );
  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    "/api/v1/organizations/:id",
    { schema: { body: organizationBody } },
    async (request) => {
      const organization = directory.updateOrganization(identityOf(request), request.params.id, request.body ?? {});
      record(request, "organization.update", organization.id, request.body);
      return { organization };
    },
  );
  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>(
    "/api/v1/organizations/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["confirmation"],
          properties: { confirmation: { type: "string", maxLength: 200 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const current = directory.getOrganization(identityOf(request), request.params.id);
      if (request.body.confirmation !== current.name)
        throw new AppError(
          400,
          "CONFIRMATION_REQUIRED",
          "Para eliminar la organización, confirma escribiendo su nombre",
        );
      directory.deleteOrganization(identityOf(request), request.params.id);
      record(request, "organization.delete", current.id, { name: current.name });
      return reply.code(204).send();
    },
  );

  const namespaceBody = {
    organizationId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 1000 },
    visibility: { type: "string", enum: ["internal", "restricted"] },
  };
  // ------------------------------------------------------------ categories
  app.get("/api/v1/categories", async (request) => ({
    categories: categories.list(auth.packageReader(identityOf(request))),
  }));
  app.post<{ Body: { name: string; description?: string } }>(
    "/api/v1/categories",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", maxLength: 64 }, description: { type: "string", maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      requireRole(request, "admin");
      const category = categories.create(request.body);
      record(request, "category.create", category.name);
      return reply.code(201).send({ category });
    },
  );
  app.patch<{ Params: { name: string }; Body: { description?: string } }>(
    "/api/v1/categories/:name",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { description: { type: "string", maxLength: 500 } },
        },
      },
    },
    async (request) => {
      requireRole(request, "admin");
      const category = categories.update(request.params.name, request.body);
      record(request, "category.update", category.name);
      return { category };
    },
  );
  app.delete<{ Params: { name: string } }>("/api/v1/categories/:name", async (request, reply) => {
    requireRole(request, "admin");
    categories.remove(request.params.name);
    record(request, "category.delete", request.params.name);
    return reply.code(204).send();
  });

  app.get("/api/v1/namespaces", async (request) => ({ namespaces: directory.listNamespaces(identityOf(request)) }));
  app.post<{
    Body: { name: string; organizationId?: string; description?: string; visibility?: "internal" | "restricted" };
  }>(
    "/api/v1/namespaces",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 2, maxLength: 65 }, ...namespaceBody },
        },
      },
    },
    async (request, reply) => {
      const namespace = directory.createNamespace(identityOf(request), {
        ...request.body,
        organizationId: request.body.organizationId ?? undefined,
      });
      record(request, "namespace.create", namespace.name, {
        organizationId: namespace.organizationId,
        visibility: namespace.visibility,
      });
      return reply.code(201).send({ namespace });
    },
  );
  app.patch<{
    Params: { name: string };
    Body: { organizationId?: string | null; description?: string; visibility?: "internal" | "restricted" };
  }>(
    "/api/v1/namespaces/:name",
    {
      schema: { body: { type: "object", additionalProperties: false, properties: namespaceBody } },
    },
    async (request) => {
      const namespace = directory.updateNamespace(identityOf(request), request.params.name, request.body ?? {});
      record(request, "namespace.update", namespace.name, request.body);
      return { namespace };
    },
  );
  app.delete<{ Params: { name: string } }>("/api/v1/namespaces/:name", async (request, reply) => {
    const namespace = directory.deleteNamespace(identityOf(request), request.params.name);
    record(request, "namespace.delete", namespace.name);
    return reply.code(204).send();
  });

  app.get("/api/v1/agents", async (request) => {
    const visible = auth.packageReader(identityOf(request));
    return { agents: packages.list().filter((item) => visible(item.name) && isAgentPackage(item.manifest)) };
  });
  app.get<{ Querystring: { capability?: string } }>("/api/v1/capabilities", async (request) => {
    const visible = auth.packageReader(identityOf(request));
    const latest = packages.list().filter((item) => visible(item.name));
    // Capability contracts (provides/requires) and tools per package, plus the tools MODAI itself offers to agents.
    const builtin = Object.entries(BUILTIN_TOOLS).map(([name, tool]) => ({
      name,
      description: tool.description,
      readOnly: tool.readOnly,
      inputSchema: tool.inputSchema,
    }));
    const contracts = latest
      .flatMap((item) => {
        try {
          const spec = normalizeManifest(item.manifest).spec;
          return [
            {
              packageName: item.name,
              version: item.version,
              category: spec.category,
              provides: spec.provides,
              requires: spec.requires,
              optional: spec.optional,
              tools: spec.contributes.tools.map((tool) => ({ name: tool.name, implements: tool.implements })),
            },
          ];
        } catch {
          return [];
        }
      })
      .filter(
        (item) =>
          !request.query.capability ||
          item.provides.some((provided) => provided.capability === request.query.capability),
      );
    return { builtin, contracts };
  });
  app.post("/api/v1/agents/compose", async (request) => {
    const input = parseInput(composeSchema, request.body);
    auth.requireProject(identityOf(request), input.projectId);
    auth.requireReadPackage(identityOf(request), input.name);
    return { bundle: await agents.compose(input.projectId, input.name, input.range, input.overrides) };
  });
  app.post("/api/v1/runs", async (request, reply) => {
    const actor = requireRole(request, "publisher"),
      input = parseInput(runSchema, request.body);
    auth.requireProject(actor, input.projectId, true);
    auth.requireReadPackage(actor, input.name);
    const bundle = await agents.compose(input.projectId, input.name, input.range, input.overrides);
    const run = runs.submit(bundle, input.task, actor.id, input.idempotencyKey);
    record(request, "run.submit", run.id, { projectId: run.projectId });
    return reply.code(201).send({ run });
  });
  app.get<{ Querystring: { projectId: string } }>("/api/v1/runs", async (request) => {
    auth.requireProject(identityOf(request), request.query.projectId);
    return { runs: runs.list(request.query.projectId) };
  });
  app.get<{ Params: { id: string } }>("/api/v1/runs/:id", async (request) => {
    requireRole(request, "reader");
    const run = runs.get(request.params.id);
    auth.requireProject(identityOf(request), run.projectId);
    return { run };
  });
  app.post<{ Params: { id: string } }>("/api/v1/runs/:id/cancel", async (request) => {
    requireRole(request, "publisher");
    const run = runs.get(request.params.id);
    auth.requireProject(identityOf(request), run.projectId, true);
    const cancelled = runs.cancel(run.id);
    record(request, "run.cancel", run.id);
    return { run: cancelled };
  });
  app.post<{ Body: { projectId: string } }>(
    "/api/v1/worker/claim",
    {
      schema: {
        body: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string", minLength: 1, maxLength: 200 } },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const actor = requireRole(request, "worker");
      auth.requireProject(actor, request.body.projectId, true);
      const claimed = runs.claim(request.body.projectId, actor.id);
      if (claimed) record(request, "run.claim", claimed.run.id);
      return { claimed: claimed ?? null };
    },
  );
  const leaseSchema = {
    type: "object",
    required: ["leaseToken"],
    properties: {
      leaseToken: { type: "string", minLength: 1, maxLength: 200 },
      result: { type: "string", maxLength: 1_000_000 },
      error: { type: "string", maxLength: 1_000_000 },
    },
    additionalProperties: false,
  };
  app.post<{ Params: { id: string }; Body: { leaseToken: string } }>(
    "/api/v1/worker/runs/:id/heartbeat",
    { schema: { body: leaseSchema } },
    async (request) => {
      const actor = requireRole(request, "worker"),
        run = runs.get(request.params.id);
      auth.requireProject(actor, run.projectId, true);
      return { leaseExpiresAt: runs.heartbeat(run.id, actor.id, request.body.leaseToken) };
    },
  );
  app.post<{ Params: { id: string }; Body: { leaseToken: string; result?: string; error?: string } }>(
    "/api/v1/worker/runs/:id/finish",
    { schema: { body: leaseSchema } },
    async (request) => {
      const actor = requireRole(request, "worker"),
        run = runs.get(request.params.id);
      auth.requireProject(actor, run.projectId, true);
      const finished = runs.finish(run.id, actor.id, request.body.leaseToken, request.body.result, request.body.error);
      record(request, "run.finish", run.id, { status: finished.status });
      return { run: finished };
    },
  );

  // ------------------------------------------------------------ API keys
  // Every key created from here on belongs to a user and stays within that user's permissions. Keys without an owner
  // are service keys: they work as they are and can be assigned an owner.
  const ownerOf = (actor: Identity): string | undefined => (actor.kind === "user" ? actor.id : actor.ownerId);
  const createOwnedKey = (
    actor: Identity,
    owner: UserRecord,
    input: { label: string; role: Role; inherit?: boolean } & KeyGrants,
  ) => {
    const inherit =
      input.inherit ?? !(input.projectIds?.length || input.organizationIds?.length || input.packageScopes?.length);
    auth.assertKeyWithinOwner(owner, input.role, input, inherit);
    const key = auth.createKey(input.label, input.role, inherit ? {} : input, { ownerId: owner.id, inherit });
    audit.record(actor.label, "api-key.create", key.id, {
      label: key.label,
      role: key.role,
      owner: owner.username,
      inherit,
    });
    return key;
  };

  app.get("/api/v1/me/api-keys", async (request) => {
    const actor = requireRole(request, "reader"),
      owner = ownerOf(actor);
    if (!owner) throw new AppError(400, "NO_OWNER", "Esta credencial no pertenece a un usuario");
    return { keys: auth.listKeys(owner) };
  });
  app.post("/api/v1/me/api-keys", async (request, reply) => {
    const actor = requireRole(request, "reader");
    // Keys are created from a person's session, so a leaked key cannot mint new ones.
    if (actor.kind !== "user")
      throw new AppError(403, "SESSION_REQUIRED", "Crea API keys desde el panel con tu usuario");
    const input = parseInput(keySchema.omit({ ownerId: true }), request.body);
    return reply.code(201).send({ key: createOwnedKey(actor, auth.getUser(actor.id), input) });
  });
  app.delete<{ Params: { id: string } }>("/api/v1/me/api-keys/:id", async (request, reply) => {
    const actor = requireRole(request, "reader"),
      key = auth.getKey(request.params.id);
    if (!key.ownerId || key.ownerId !== ownerOf(actor))
      throw new AppError(404, "API_KEY_NOT_FOUND", "Clave no encontrada");
    auth.revokeKey(key.id);
    record(request, "api-key.revoke", key.id, { owner: key.ownerName });
    return reply.code(204).send();
  });

  app.get<{ Querystring: { ownerId?: string } }>("/api/v1/admin/api-keys", async (request) => {
    const actor = auth.requireManager(identityOf(request));
    return { keys: auth.listKeys(request.query.ownerId || undefined).filter((key) => auth.canManageKey(actor, key)) };
  });
  app.post("/api/v1/admin/api-keys", async (request, reply) => {
    const actor = auth.requireManager(identityOf(request));
    const input = parseInput(keySchema, request.body);
    const ownerId = input.ownerId === undefined ? ownerOf(actor) : (input.ownerId ?? undefined);
    if (ownerId) {
      const owner = auth.getUser(ownerId);
      if (!auth.canManageGrantee(actor, owner) && owner.id !== ownerOf(actor))
        throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado");
      return reply.code(201).send({ key: createOwnedKey(actor, owner, input) });
    }
    // Ownerless (service) keys: only the installation token or a global admin, for automation before users exist.
    if (actor.role !== "admin") throw new AppError(400, "OWNER_REQUIRED", "Elige el usuario dueño de la API key");
    auth.assertGrants(actor, input.role, input);
    const key = auth.createKey(input.label, input.role, input);
    record(request, "api-key.create", key.id, { label: key.label, role: key.role });
    return reply.code(201).send({ key });
  });
  app.patch<{ Params: { id: string } }>("/api/v1/admin/api-keys/:id", async (request) => {
    const actor = auth.requireManager(identityOf(request));
    const input = parseInput(
      keySchema.pick({ projectIds: true, organizationIds: true, packageScopes: true, ownerId: true, inherit: true }),
      request.body,
    );
    const current = auth.getKey(request.params.id);
    if (!auth.canManageKey(actor, current)) throw new AppError(404, "API_KEY_NOT_FOUND", "Clave no encontrada");
    const ownerId = input.ownerId === undefined ? current.ownerId : (input.ownerId ?? undefined);
    if (current.ownerId && !ownerId)
      throw new AppError(400, "OWNER_REQUIRED", "Una API key con dueño no puede quedar sin dueño");
    const inherit = input.inherit ?? current.inherit;
    if (ownerId) {
      const owner = auth.getUser(ownerId);
      if (!auth.canManageGrantee(actor, owner) && owner.id !== ownerOf(actor))
        throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado");
      auth.assertKeyWithinOwner(owner, current.role, input, inherit);
    } else auth.assertGrants(actor, current.role, input);
    auth.updateKeyGrants(request.params.id, inherit ? {} : input, { ownerId: ownerId ?? null, inherit });
    record(request, "api-key.grants", request.params.id, { ...input, inherit });
    return { key: auth.getKey(request.params.id) };
  });
  app.delete<{ Params: { id: string } }>("/api/v1/admin/api-keys/:id", async (request, reply) => {
    const actor = auth.requireManager(identityOf(request));
    if (!auth.canManageKey(actor, auth.getKey(request.params.id)))
      throw new AppError(404, "API_KEY_NOT_FOUND", "Clave no encontrada");
    auth.revokeKey(request.params.id);
    record(request, "api-key.revoke", request.params.id);
    return reply.code(204).send();
  });
  app.get<{ Querystring: { limit?: string } }>("/api/v1/admin/audit", async (request) => {
    requireRole(request, "admin");
    return { events: audit.list(Number(request.query.limit) || 100) };
  });
  app.get("/api/v1/admin/export", async (request) => {
    requireRole(request, "admin");
    record(request, "backup.export", "server");
    return backup.export();
  });
  // A real backup carries every artifact: far above the default 1 MiB body limit.
  app.post<{ Body: Parameters<BackupService["import"]>[0] }>(
    "/api/v1/admin/import",
    { bodyLimit: 1024 * 1024 * 1024 },
    async (request) => {
      requireRole(request, "admin");
      const result = backup.import(request.body);
      record(request, "backup.import", "server", result);
      return result;
    },
  );
  /**
   * Retention. Each target is pruned only when its field is present; an empty body keeps the historic defaults
   * (memories 365 days, audit 90 days). `dryRun` returns the counts without deleting.
   */
  app.post<{ Body: { memoryDays?: number; auditDays?: number; dryRun?: boolean } }>(
    "/api/v1/admin/prune",
    {
      schema: {
        body: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            memoryDays: { type: "integer", minimum: 0, maximum: 36500 },
            auditDays: { type: "integer", minimum: 0, maximum: 36500 },
            dryRun: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      requireRole(request, "admin");
      const body = request.body ?? {};
      const usesDefaults = body.memoryDays === undefined && body.auditDays === undefined;
      const memoryDays = usesDefaults ? 365 : body.memoryDays,
        auditDays = usesDefaults ? 90 : body.auditDays,
        dryRun = body.dryRun === true;
      const result = {
        memories: memoryDays === undefined ? 0 : context.pruneMemories(memoryDays, dryRun),
        audit: auditDays === undefined ? 0 : audit.prune(auditDays, dryRun),
        dryRun,
      };
      if (!dryRun) record(request, "retention.prune", "server", { ...result, memoryDays, auditDays });
      return result;
    },
  );
  app.get("/metrics", async (request, reply) => {
    requireRole(request, "reader");
    return reply.type("text/plain; version=0.0.4").send(metrics.prometheus());
  });

  app.addHook("onClose", async () => db.close());
  return app;
}
