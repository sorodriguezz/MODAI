import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { AuditService } from "../core/audit-service.js";
import { AuthService, type Identity, type Role } from "../core/auth-service.js";
import { BackupService } from "../core/backup-service.js";
import { ContextService } from "../core/context-service.js";
import { Database } from "../core/database.js";
import { AppError } from "@modai/contracts/errors";
import { MetricsService } from "../core/metrics-service.js";
import { analyzePackageQuality } from "@modai/contracts/package-quality";
import { UsageService } from "../core/usage-service.js";
import { PackageService } from "../core/package-service.js";
import type { MemoryInput, PublishPackageInput, ResolveRequest } from "@modai/contracts/types";
import { AgentService } from "../core/agent-service.js";
import { isAgentPackage, legacyCapabilities, manifestIdentity, normalizeManifest } from "@modai/core";
import { RunService } from "../core/run-service.js";
import { parseInput, publishSchema, projectSchema, keySchema, memorySchema, memoryQuerySchema, composeSchema, runSchema, resolveSchema } from "@modai/contracts/schemas";
import type { SignaturePolicy } from "@modai/contracts/types";
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

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  let publicUrl: string | undefined;
  if (options.publicUrl) {
    const url = new URL(options.publicUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('MODAI_PUBLIC_URL debe ser un origen HTTP(S), sin ruta ni credenciales');
    publicUrl = url.origin;
  }
  // Fastify accepts a hop count for trustProxy at runtime; its typings omit it.
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 1024 * 1024, trustProxy: (options.trustProxy ?? false) as boolean });
  const db = new Database(options.databasePath);
  const packages = new PackageService(db, options.artifactDirectory, options.signaturePolicy, options.maxArtifactStorageBytes);
  const context = new ContextService(db);
  const agents = new AgentService(packages);
  const runs = new RunService(db, options.workerLeaseMs);
  const auth = new AuthService(db, options.apiToken, { idleMs: options.sessionIdleMs, absoluteMs: options.sessionMaxMs });
  const usage = new UsageService(db);
  try { await seedInitialAdmin(auth, new AuditService(db), options.initialAdmin); } catch (error) { db.close(); throw error; }
  if (!auth.configured()) { db.close(); throw new AppError(500, "AUTH_NOT_CONFIGURED", "Configura MODAI_API_TOKEN, MODAI_ADMIN_USERNAME/MODAI_ADMIN_PASSWORD o una API key admin activa antes de arrancar"); }
  const audit = new AuditService(db);
  const metrics = new MetricsService();
  const backup = new BackupService(db, packages, context);

  await app.register(cors, { origin: false });
  await app.register(helmet, { contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"], styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"], connectSrc: ["'self'"], frameAncestors: ["'none'"], upgradeInsecureRequests: null,
  } }, frameguard: { action: "deny" } });
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
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details, requestId: request.id } });
    }
    request.log.error(error);
    const generic = error as { statusCode?: number; message?: string };
    const statusCode = typeof generic?.statusCode === "number" ? generic.statusCode : 500;
    return reply.code(statusCode).send({
      error: { code: statusCode === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR", message: statusCode >= 500 ? "Error interno" : generic.message, requestId: request.id },
    });
  });

  app.get("/health", async () => ({ status: "ok", service: "modularai", version: "0.8.1", apiVersion: 1, signaturePolicy: options.signaturePolicy ?? "optional", runtime: process.version, publicUrl }));
  app.get("/", async (_request, reply) => reply.redirect("/admin"));
  if (options.adminDirectory !== false) {
    try { registerAdminAssets(app, options.adminDirectory); }
    catch (error) { db.close(); throw error; }
  }
  app.get("/api/v1", async (request) => {
    requireRole(request, "reader");
    return { name: "ModularAI API", version: "v1", resources: ["packages", "resolve", "artifacts", "knowledge", "memories", "admin", "metrics"], architecture: { server: "registry-context-and-agent-control", inference: "client-or-worker", embeddings: "client-generated" } };
  });
  app.get("/api/v1/session", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const identity = requireRole(request, "reader");
    return { label: identity.label, role: identity.role, projectIds: identity.projectIds, organizationIds: identity.organizationIds, packageScopes: identity.packageScopes };
  });
  registerAuthRoutes(app, { auth, audit, publicUrl, loginRateLimitMax: options.loginRateLimitMax, loginDelayMs: options.loginDelayMs });

  app.get<{ Querystring: { q?: string; type?: string; includeYanked?: string; name?: string } }>("/api/v1/packages", async (request) => {
    requireRole(request, "reader");
    const list = packages.list(request.query.name ?? request.query.q, request.query.type, request.query.includeYanked === "true");
    return { packages: request.query.name ? list.filter(item => item.name === request.query.name) : list };
  });
  app.get<{ Querystring: { q?: string; type?: string; category?: string; format?: string; status?: string; limit?: string; offset?: string } }>("/api/v1/packages/catalog", async (request) => {
    requireRole(request, "reader");
    const { limit, offset, ...filters } = request.query;
    return packages.catalog({ ...filters, limit: limit ? Number(limit) : undefined, offset: offset ? Number(offset) : undefined });
  });
  app.get("/api/v1/packages/summary", async (request) => {
    requireRole(request, "reader");
    return packages.summary();
  });
  app.get<{ Querystring: { name: string } }>("/api/v1/packages/usage", async (request) => {
    const identity = requireRole(request, "reader");
    const visible = new Set(auth.listProjects(identity).map(project => project.id));
    return { projects: usage.usage(String(request.query.name ?? ""), projectId => visible.has(projectId)) };
  });
  app.put<{ Params: { id: string }; Body: { packages: Array<{ name: string; version: string; direct?: boolean }> } }>("/api/v1/projects/:id/installations", {
    schema: { body: { type: "object", required: ["packages"], additionalProperties: false, properties: { packages: { type: "array", maxItems: 1000, items: {
      type: "object", required: ["name", "version"], additionalProperties: false,
      properties: { name: { type: "string", minLength: 3, maxLength: 214, pattern: "^@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$" }, version: { type: "string", minLength: 1, maxLength: 100 }, direct: { type: "boolean" } } } } } } },
  }, async (request, reply) => {
    // Any key with access to the project may report what it installed there: it is metadata, not content.
    auth.requireProject(identityOf(request), request.params.id);
    usage.report(request.params.id, request.body.packages);
    return reply.code(204).send();
  });
  app.get<{ Querystring: { name: string; version?: string } }>("/api/v1/package", async (request) => {
    requireRole(request, "reader");
    return { package: packages.get(request.query.name, request.query.version) };
  });
  app.post<{ Body: PublishPackageInput }>("/api/v1/packages/validate", async (request) => {
    requireRole(request, "reader");
    const input = parseInput(publishSchema, request.body);
    return { quality: analyzePackageQuality(input.manifest, input.files) };
  });
  app.post<{ Body: PublishPackageInput }>("/api/v1/packages", { bodyLimit: 36 * 1024 * 1024 }, async (request, reply) => {
    const input = parseInput(publishSchema, request.body);
    auth.requirePublish(identityOf(request), manifestIdentity(input.manifest).name);
    const published = packages.publish(input);
    record(request, "package.publish", `${published.name}@${published.version}`, { signed: Boolean(request.body.signature), quality: published.quality?.score });
    return reply.code(201).send({ package: published });
  });
  app.post<{ Body: ResolveRequest }>("/api/v1/resolve", async (request) => {
    requireRole(request, "reader");
    return { packages: await packages.resolve(parseInput(resolveSchema, request.body)) };
  });
  app.get<{ Params: { id: string } }>("/api/v1/artifacts/:id", async (request) => {
    requireRole(request, "reader");
    return packages.getArtifact(request.params.id);
  });
  app.post<{ Body: { name: string; version: string; message: string } }>("/api/v1/admin/packages/deprecate", async (request) => {
    requireRole(request, "admin");
    const item = packages.deprecate(request.body.name, request.body.version, request.body.message);
    record(request, "package.deprecate", `${item.name}@${item.version}`, { message: request.body.message });
    return { package: item };
  });
  app.post<{ Body: { name: string; version: string; reason: string } }>("/api/v1/admin/packages/yank", async (request) => {
    requireRole(request, "admin");
    const item = packages.yank(request.body.name, request.body.version, request.body.reason);
    record(request, "package.yank", `${item.name}@${item.version}`, { reason: request.body.reason });
    return { package: item };
  });
  app.delete<{ Body: { name: string; version: string; confirmation: string } }>("/api/v1/admin/packages", async (request, reply) => {
    requireRole(request, "admin");
    packages.hardDelete(request.body.name, request.body.version, request.body.confirmation);
    record(request, "package.delete", request.body.confirmation);
    return reply.code(204).send();
  });
  app.get("/api/v1/admin/publishers", async (request) => {
    requireRole(request, "admin");
    return { publishers: packages.listPublishers() };
  });
  app.post<{ Body: { publicKey: string; label: string; trusted: boolean } }>("/api/v1/admin/publishers", { schema: { body: { type: "object", required: ["publicKey", "label", "trusted"], properties: { publicKey: { type: "string", maxLength: 4096 }, label: { type: "string", maxLength: 200 }, trusted: { type: "boolean" } }, additionalProperties: false } } }, async request => {
    requireRole(request, "admin");
    const fingerprint = packages.registerPublisher(request.body.publicKey, request.body.label, request.body.trusted);
    record(request, "publisher.register", fingerprint); return { fingerprint };
  });
  app.patch<{ Params: { fingerprint: string }; Body: { trusted: boolean; label?: string } }>("/api/v1/admin/publishers/:fingerprint", async (request) => {
    requireRole(request, "admin");
    packages.trustPublisher(request.params.fingerprint, request.body.trusted, request.body.label);
    record(request, "publisher.trust", request.params.fingerprint, request.body);
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/api/v1/knowledge/documents", async (request) => {
    requireRole(request, "reader");
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(request.query.offset) || 0, 0);
    const documents = context.listKnowledge(limit, offset);
    return { documents, nextOffset: documents.length === limit ? offset + limit : null };
  });
  app.post<{ Body: { title: string; content: string; tags?: string[]; packageName?: string } }>("/api/v1/knowledge/documents", async (request, reply) => {
    requireRole(request, "publisher");
    const document = context.addKnowledge(request.body);
    record(request, "knowledge.create", String(document.id));
    return reply.code(201).send({ document });
  });
  app.patch<{ Params: { id: string }; Body: { title?: string; content?: string; tags?: string[] } }>("/api/v1/knowledge/documents/:id", async (request) => {
    requireRole(request, "publisher");
    const document = context.updateKnowledge(request.params.id, request.body);
    record(request, "knowledge.update", request.params.id);
    return { document };
  });
  app.delete<{ Params: { id: string } }>("/api/v1/knowledge/documents/:id", async (request, reply) => {
    requireRole(request, "publisher");
    context.deleteKnowledge(request.params.id);
    record(request, "knowledge.delete", request.params.id);
    return reply.code(204).send();
  });
  app.post<{ Body: { query: string; limit?: number; packageNames?: string[] } }>("/api/v1/knowledge/search", async (request) => {
    requireRole(request, "reader");
    return { results: context.searchKnowledge(request.body) };
  });
  const vectorSchema = { type: "array", minItems: 1, maxItems: 8192, items: { type: "number" } };
  app.put<{ Params: { id: string }; Body: { model: string; embedding: number[]; sourceHash?: string } }>("/api/v1/knowledge/documents/:id/vector", {
    schema: { body: { type: "object", required: ["model", "embedding"], properties: { model: { type: "string", minLength: 1, maxLength: 200 }, embedding: vectorSchema, sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" } } } },
  }, async (request) => {
    requireRole(request, "publisher");
    const doc = db.connection.prepare("SELECT title, content FROM knowledge_documents WHERE id = ?").get(request.params.id) as { title: string; content: string } | undefined;
    if (!doc) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", "Documento no encontrado");
    if (request.body.sourceHash && request.body.sourceHash !== createHash("sha256").update(doc.title + "\n" + doc.content).digest("hex")) throw new AppError(409, "DOCUMENT_CHANGED", "El documento cambió durante la indexación; vuelve a indexarlo.");
    if (!request.body.embedding.some((value) => value !== 0)) throw new AppError(400, "INVALID_VECTOR", "El vector no puede ser cero");
    context.saveVector(request.params.id, request.body.model, request.body.embedding);
    record(request, "knowledge.vector-upload", request.params.id, { model: request.body.model });
    return { ok: true };
  });
  app.post<{ Body: { embedding: number[]; model: string; limit?: number; packageNames?: string[] } }>("/api/v1/knowledge/vector-search", {
    schema: { body: { type: "object", required: ["model", "embedding"], properties: { model: { type: "string", minLength: 1, maxLength: 200 }, embedding: vectorSchema, limit: { type: "integer", minimum: 1, maximum: 50 }, packageNames: { type: "array", maxItems: 200, items: { type: "string" } } } } },
  }, async (request) => {
    requireRole(request, "reader");
    return { results: await context.vectorSearchAsync(request.body.embedding, request.body.model, request.body.limit, request.body.packageNames) };
  });

  app.post<{ Body: MemoryInput }>("/api/v1/memories", async (request, reply) => {
    const actor = requireRole(request, "reader");
    const input = parseInput(memorySchema, request.body);
    const project = auth.requireProject(actor, input.projectId, true);
    if (input.scope === "organization") auth.requireOrganization(actor, project.organizationId);
    if (input.scope === "session" && !input.sessionId) throw new AppError(400, "SESSION_REQUIRED", "sessionId es obligatorio");
    const memory = context.remember(input, actor.id, project.organizationId);
    record(request, "memory.create", String(memory.id), { projectId: input.projectId });
    return reply.code(201).send({ memory });
  });
  app.get<{ Querystring: { projectId: string; limit?: string; includeOrganization?: string; sessionId?: string } }>("/api/v1/memories", async (request) => {
    const project = auth.requireProject(identityOf(request), request.query.projectId);
    const organizationId = request.query.includeOrganization === "true" ? project.organizationId : undefined;
    if (request.query.includeOrganization === "true") auth.requireOrganization(identityOf(request), organizationId);
    return { memories: context.listMemories(project.id, Number(request.query.limit) || 50, { organizationId, sessionId: request.query.sessionId }) };
  });
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

  app.get("/api/v1/projects", async request => ({ projects: auth.listProjects(identityOf(request)) }));
  app.post("/api/v1/projects", async (request, reply) => {
    const project = auth.createProject(identityOf(request), parseInput(projectSchema, request.body));
    record(request, "project.create", project.id);
    return reply.code(201).send({ project });
  });
  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>("/api/v1/projects/:id", {
    schema: { body: { type: "object", required: ["confirmation"], properties: { confirmation: { type: "string", maxLength: 200 } }, additionalProperties: false } },
  }, async request => {
    if (request.body.confirmation !== request.params.id) throw new AppError(400, "CONFIRMATION_REQUIRED", "Para eliminar el proyecto, confirma escribiendo su identificador");
    const result = auth.deleteProject(identityOf(request), request.params.id);
    record(request, "project.delete", request.params.id, { name: result.project.name, memories: result.memories, runs: result.runs });
    return { deleted: result.project, memories: result.memories, runs: result.runs };
  });
  app.post<{ Body: { name: string } }>("/api/v1/admin/organizations", { schema: { body: { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 200 } }, additionalProperties: false } } }, async (request, reply) => {
    requireRole(request, "admin");
    const organization = auth.createOrganization(request.body.name);
    record(request, "organization.create", organization.id);
    return reply.code(201).send({ organization });
  });
  app.get("/api/v1/agents", async request => { requireRole(request, "reader"); return { agents: packages.list().filter(item => isAgentPackage(item.manifest)) }; });
  app.get<{ Querystring: { capability?: string } }>("/api/v1/capabilities", async request => {
    requireRole(request, "reader");
    const latest = packages.list();
    // Legacy runtime capabilities plus v1 capability contracts (provides/requires) and tools.
    const capabilities = latest.flatMap(item => legacyCapabilities(item.manifest).map(capability => ({ packageName: item.name, version: item.version, capability })));
    const contracts = latest.flatMap(item => {
      try {
        const spec = normalizeManifest(item.manifest).spec;
        return [{ packageName: item.name, version: item.version, category: spec.category, provides: spec.provides, requires: spec.requires, optional: spec.optional, tools: spec.contributes.tools.map(tool => ({ name: tool.name, implements: tool.implements })) }];
      } catch { return []; }
    }).filter(item => !request.query.capability || item.provides.some(provided => provided.capability === request.query.capability));
    return { capabilities, contracts };
  });
  app.post("/api/v1/agents/compose", async request => {
    const input = parseInput(composeSchema, request.body);
    auth.requireProject(identityOf(request), input.projectId);
    return { bundle: await agents.compose(input.projectId, input.name, input.range, input.overrides) };
  });
  app.post("/api/v1/runs", async (request, reply) => {
    const actor = requireRole(request, "publisher"), input = parseInput(runSchema, request.body);
    auth.requireProject(actor, input.projectId, true);
    const bundle = await agents.compose(input.projectId, input.name, input.range, input.overrides);
    const run = runs.submit(bundle, input.task, actor.id, input.idempotencyKey);
    record(request, "run.submit", run.id, { projectId: run.projectId });
    return reply.code(201).send({ run });
  });
  app.get<{ Querystring: { projectId: string } }>("/api/v1/runs", async request => {
    auth.requireProject(identityOf(request), request.query.projectId);
    return { runs: runs.list(request.query.projectId) };
  });
  app.get<{ Params: { id: string } }>("/api/v1/runs/:id", async request => {
    requireRole(request, "reader"); const run = runs.get(request.params.id);
    auth.requireProject(identityOf(request), run.projectId); return { run };
  });
  app.post<{ Params: { id: string } }>("/api/v1/runs/:id/cancel", async request => {
    requireRole(request, "publisher"); const run = runs.get(request.params.id);
    auth.requireProject(identityOf(request), run.projectId, true);
    const cancelled = runs.cancel(run.id); record(request, "run.cancel", run.id); return { run: cancelled };
  });
  app.post<{ Body: { projectId: string } }>("/api/v1/worker/claim", { schema: { body: { type: "object", required: ["projectId"], properties: { projectId: { type: "string", minLength: 1, maxLength: 200 } }, additionalProperties: false } } }, async request => {
    const actor = requireRole(request, "worker"); auth.requireProject(actor, request.body.projectId, true);
    const claimed = runs.claim(request.body.projectId, actor.id);
    if (claimed) record(request, "run.claim", claimed.run.id);
    return { claimed: claimed ?? null };
  });
  const leaseSchema = { type: "object", required: ["leaseToken"], properties: { leaseToken: { type: "string", minLength: 1, maxLength: 200 }, result: { type: "string", maxLength: 1_000_000 }, error: { type: "string", maxLength: 1_000_000 } }, additionalProperties: false };
  app.post<{ Params: { id: string }; Body: { leaseToken: string } }>("/api/v1/worker/runs/:id/heartbeat", { schema: { body: leaseSchema } }, async request => {
    const actor = requireRole(request, "worker"), run = runs.get(request.params.id); auth.requireProject(actor, run.projectId, true);
    return { leaseExpiresAt: runs.heartbeat(run.id, actor.id, request.body.leaseToken) };
  });
  app.post<{ Params: { id: string }; Body: { leaseToken: string; result?: string; error?: string } }>("/api/v1/worker/runs/:id/finish", { schema: { body: leaseSchema } }, async request => {
    const actor = requireRole(request, "worker"), run = runs.get(request.params.id); auth.requireProject(actor, run.projectId, true);
    const finished = runs.finish(run.id, actor.id, request.body.leaseToken, request.body.result, request.body.error);
    record(request, "run.finish", run.id, { status: finished.status }); return { run: finished };
  });

  app.get("/api/v1/admin/api-keys", async (request) => {
    requireRole(request, "admin");
    return { keys: auth.listKeys() };
  });
  app.post<{ Body: { label: string; role: Role } }>("/api/v1/admin/api-keys", async (request, reply) => {
    requireRole(request, "admin");
    const input = parseInput(keySchema, request.body);
    const key = auth.createKey(input.label, input.role, input);
    record(request, "api-key.create", key.id, { label: key.label, role: key.role });
    return reply.code(201).send({ key });
  });
  app.patch<{ Params: { id: string } }>("/api/v1/admin/api-keys/:id", async request => {
    requireRole(request, "admin");
    const grants = parseInput(keySchema.pick({ projectIds: true, organizationIds: true, packageScopes: true }), request.body);
    auth.updateKeyGrants(request.params.id, grants); record(request, "api-key.grants", request.params.id, grants); return { ok: true };
  });
  app.delete<{ Params: { id: string } }>("/api/v1/admin/api-keys/:id", async (request, reply) => {
    requireRole(request, "admin");
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
  app.post<{ Body: Parameters<BackupService["import"]>[0] }>("/api/v1/admin/import", async (request) => {
    requireRole(request, "admin");
    const result = backup.import(request.body);
    record(request, "backup.import", "server", result);
    return result;
  });
  app.post<{ Body: { memoryDays?: number; auditDays?: number } }>("/api/v1/admin/prune", async (request) => {
    requireRole(request, "admin");
    const result = { memories: context.pruneMemories(request.body.memoryDays ?? 365), audit: audit.prune(request.body.auditDays ?? 90) };
    record(request, "retention.prune", "server", result);
    return result;
  });
  app.get("/metrics", async (request, reply) => {
    requireRole(request, "reader");
    return reply.type("text/plain; version=0.0.4").send(metrics.prometheus());
  });

  app.addHook("onClose", async () => db.close());
  return app;
}
