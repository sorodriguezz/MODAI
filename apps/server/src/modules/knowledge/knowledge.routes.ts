import { createHash } from "node:crypto";
import { AppError } from "@modai/contracts/errors";
import { knowledgeQuerySchema, parseInput, profileKnowledgeSchema } from "@modai/contracts/schemas";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";
import { createKnowledgeBody, updateKnowledgeBody, vectorBody, vectorSearchBody } from "./knowledge.schemas.js";
import { withPackageVersions } from "./knowledge-scope.js";

type VectorSearchBody = { embedding: number[]; model: string; limit?: number; packageNames?: string[] };

function projectSearchRoute(app: FastifyInstance, { authz, knowledge, projects, profiles }: Services): void {
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/knowledge/search", async (request, reply) => {
    const actor = authz.require(identityOf(request), "reader");
    const project = await projects.requireProject(actor, request.params.id);
    const input = parseInput(profileKnowledgeSchema, request.body);
    const profile = await profiles.resolve(actor, project, input.platform);
    const selected = input.packageNames && new Set(input.packageNames);
    const packages = profile.packages.filter((item) => !selected || selected.has(item.name));
    if (!packages.length) return { results: [] };
    const visible = authz.packageVisibility(actor);
    reply.header("Cache-Control", "private, no-store");
    const results = await knowledge.search(
      { query: input.query, limit: input.limit },
      withPackageVersions(packages, visible),
    );
    return { results };
  });
}

function documentRoutes(app: FastifyInstance, { authz, knowledge, audit }: Services): void {
  app.get<{ Querystring: { limit?: string; offset?: string } }>("/api/v1/knowledge/documents", async (request) => {
    const visible = authz.packageVisibility(identityOf(request));
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(request.query.offset) || 0, 0);
    const documents = await knowledge.list(limit, offset, visible);
    return { documents, nextOffset: documents.length === limit ? offset + limit : null };
  });
  app.post<{ Body: { title: string; content: string; tags?: string[]; packageName?: string } }>(
    "/api/v1/knowledge/documents",
    { schema: { body: createKnowledgeBody } },
    async (request, reply) => {
      await authz.requireWriteKnowledge(identityOf(request), request.body.packageName);
      const document = await knowledge.add(request.body);
      await audit.fromRequest(request, "knowledge.create", String(document.id));
      return reply.code(201).send({ document });
    },
  );
  app.patch<{ Params: { id: string }; Body: { title?: string; content?: string; tags?: string[] } }>(
    "/api/v1/knowledge/documents/:id",
    { schema: { body: updateKnowledgeBody } },
    async (request) => {
      await authz.requireWriteKnowledge(identityOf(request), await knowledge.owner(request.params.id));
      const document = await knowledge.update(request.params.id, request.body);
      await audit.fromRequest(request, "knowledge.update", request.params.id);
      return { document };
    },
  );
  app.delete<{ Params: { id: string } }>("/api/v1/knowledge/documents/:id", async (request, reply) => {
    await authz.requireWriteKnowledge(identityOf(request), await knowledge.owner(request.params.id));
    await knowledge.delete(request.params.id);
    await audit.fromRequest(request, "knowledge.delete", request.params.id);
    return reply.code(204).send();
  });
}

function searchRoutes(app: FastifyInstance, { authz, knowledge }: Services): void {
  app.post("/api/v1/knowledge/search", async (request) => {
    const visible = authz.packageVisibility(identityOf(request));
    const { packageVersions, ...query } = parseInput(knowledgeQuerySchema, request.body);
    return {
      results: await knowledge.search(query, packageVersions ? withPackageVersions(packageVersions, visible) : visible),
    };
  });
  app.post<{ Body: VectorSearchBody }>(
    "/api/v1/knowledge/vector-search",
    { schema: { body: vectorSearchBody } },
    async (request) => {
      const visible = authz.packageVisibility(identityOf(request));
      const { embedding, model, limit, packageNames } = request.body;
      return { results: await knowledge.vectorSearch(embedding, model, limit, packageNames, visible) };
    },
  );
}

function vectorRoute(app: FastifyInstance, { authz, knowledge, audit }: Services): void {
  app.put<{ Params: { id: string }; Body: { model: string; embedding: number[]; sourceHash?: string } }>(
    "/api/v1/knowledge/documents/:id/vector",
    { schema: { body: vectorBody } },
    async (request) => {
      const doc = await knowledge.find(request.params.id);
      if (!doc) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", "Documento no encontrado");
      await authz.requireWriteKnowledge(identityOf(request), doc.package_name);
      const hash = createHash("sha256").update(`${doc.title}\n${doc.content}`).digest("hex");
      if (request.body.sourceHash && request.body.sourceHash !== hash)
        throw new AppError(409, "DOCUMENT_CHANGED", "El documento cambió durante la indexación; vuelve a indexarlo.");
      if (!request.body.embedding.some((value) => value !== 0))
        throw new AppError(400, "INVALID_VECTOR", "El vector no puede ser cero");
      await knowledge.saveVector(request.params.id, request.body.model, request.body.embedding);
      await audit.fromRequest(request, "knowledge.vector-upload", request.params.id, { model: request.body.model });
      return { ok: true };
    },
  );
}

export async function knowledgeRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  documentRoutes(app, services);
  searchRoutes(app, services);
  projectSearchRoute(app, services);
  vectorRoute(app, services);
}
