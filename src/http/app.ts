import cors from "@fastify/cors";
import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { AuditService } from "../core/audit-service.js";
import { AuthService, type Identity, type Role } from "../core/auth-service.js";
import { BackupService } from "../core/backup-service.js";
import { ContextService } from "../core/context-service.js";
import { Database } from "../core/database.js";
import { AppError } from "../core/errors.js";
import { MetricsService } from "../core/metrics-service.js";
import { analyzePackageQuality } from "../core/package-quality.js";
import { PackageService } from "../core/package-service.js";
import type { MemoryInput, PublishPackageInput, ResolveRequest } from "../core/types.js";
import { ADMIN_HTML } from "./admin-ui.js";

export interface AppOptions {
  databasePath: string;
  artifactDirectory: string;
  apiToken?: string;
  logger?: boolean;
}

type AuthenticatedRequest = FastifyRequest & { modaiIdentity?: Identity };

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 50 * 1024 * 1024 });
  const db = new Database(options.databasePath);
  const packages = new PackageService(db, options.artifactDirectory);
  const context = new ContextService(db);
  const auth = new AuthService(db, options.apiToken);
  const audit = new AuditService(db);
  const metrics = new MetricsService();
  const backup = new BackupService(db, packages, context);

  await app.register(cors, { origin: false });

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

  app.get("/health", async () => ({ status: "ok", service: "modularai", version: "0.4.0", runtime: process.version }));
  app.get("/", async (_request, reply) => reply.redirect("/admin"));
  app.get("/admin", async (_request, reply) => reply.type("text/html; charset=utf-8").send(ADMIN_HTML));
  app.get("/api/v1", async (request) => {
    requireRole(request, "reader");
    return { name: "ModularAI API", version: "v1", resources: ["packages", "resolve", "artifacts", "knowledge", "memories", "admin", "metrics"], architecture: { server: "registry-and-context", inference: "client-only", embeddings: "client-generated" } };
  });
  app.get("/api/v1/session", async (request) => {
    const identity = requireRole(request, "reader");
    return { label: identity.label, role: identity.role, localMode: identity.id === "local" };
  });

  app.get<{ Querystring: { q?: string; type?: string; includeYanked?: string } }>("/api/v1/packages", async (request) => {
    requireRole(request, "reader");
    return { packages: packages.list(request.query.q, request.query.type, request.query.includeYanked === "true") };
  });
  app.get<{ Querystring: { name: string; version?: string } }>("/api/v1/package", async (request) => {
    requireRole(request, "reader");
    return { package: packages.get(request.query.name, request.query.version) };
  });
  app.post<{ Body: PublishPackageInput }>("/api/v1/packages/validate", async (request) => {
    requireRole(request, "reader");
    return { quality: analyzePackageQuality(request.body.manifest, request.body.files) };
  });
  app.post<{ Body: PublishPackageInput }>("/api/v1/packages", async (request, reply) => {
    requireRole(request, "publisher");
    const published = packages.publish(request.body);
    record(request, "package.publish", `${published.name}@${published.version}`, { signed: Boolean(request.body.signature), quality: published.quality?.score });
    return reply.code(201).send({ package: published });
  });
  app.post<{ Body: ResolveRequest }>("/api/v1/resolve", async (request) => {
    requireRole(request, "reader");
    return { packages: packages.resolve(request.body) };
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
    return { results: context.vectorSearch(request.body.embedding, request.body.model, request.body.limit, request.body.packageNames) };
  });

  app.post<{ Body: MemoryInput }>("/api/v1/memories", async (request, reply) => {
    requireRole(request, "publisher");
    const memory = context.remember(request.body);
    record(request, "memory.create", String(memory.id), { projectId: request.body.projectId });
    return reply.code(201).send({ memory });
  });
  app.get<{ Querystring: { projectId: string; limit?: string } }>("/api/v1/memories", async (request) => {
    requireRole(request, "reader");
    return { memories: context.listMemories(request.query.projectId, Number(request.query.limit) || 50) };
  });
  app.post<{ Body: { projectId: string; query: string; limit?: number } }>("/api/v1/memories/search", async (request) => {
    requireRole(request, "reader");
    return { results: context.searchMemories(request.body) };
  });
  app.patch<{ Params: { id: string }; Body: { content?: string; kind?: string; scope?: string; metadata?: Record<string, unknown> } }>("/api/v1/memories/:id", async (request) => {
    requireRole(request, "publisher");
    const memory = context.updateMemory(request.params.id, request.body);
    record(request, "memory.update", request.params.id);
    return { memory };
  });
  app.delete<{ Params: { id: string } }>("/api/v1/memories/:id", async (request, reply) => {
    requireRole(request, "publisher");
    context.deleteMemory(request.params.id);
    record(request, "memory.delete", request.params.id);
    return reply.code(204).send();
  });

  app.get("/api/v1/admin/api-keys", async (request) => {
    requireRole(request, "admin");
    return { keys: auth.listKeys() };
  });
  app.post<{ Body: { label: string; role: Role } }>("/api/v1/admin/api-keys", async (request, reply) => {
    requireRole(request, "admin");
    const key = auth.createKey(request.body.label, request.body.role);
    record(request, "api-key.create", key.id, { label: key.label, role: key.role });
    return reply.code(201).send({ key });
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
