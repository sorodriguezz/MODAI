import { createHash } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import { knowledgeQuerySchema, parseInput } from "@modai/contracts/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";
import { createKnowledgeBody, updateKnowledgeBody, vectorBody, vectorSearchBody } from "./knowledge.schemas.js";
import { catalogKnowledge, projectKnowledge, withPackageVersions } from "./knowledge-scope.js";
import { projectKnowledgeSearchRoutes } from "./project-search.routes.js";

type VectorSearchBody = { embedding: number[]; model: string; limit?: number; packageNames?: string[] };
type DocumentInput = { title: string; content: string; tags?: string[]; packageName?: string };

async function documentScope({ authz, projects }: Services, request: FastifyRequest, write = false) {
  const actor = authz.require(identityOf(request), write ? "publisher" : "reader");
  const projectId = (request.params as { projectId?: string } | undefined)?.projectId;
  if (projectId === undefined) return { actor, visible: catalogKnowledge(authz.packageVisibility(actor)) };
  const project = await projects.requireProject(actor, projectId, write);
  return { actor, project, visible: projectKnowledge(project.id) };
}

async function writableDocument(services: Services, request: FastifyRequest, id: string) {
  const { actor, project } = await documentScope(services, request, true);
  const document = await services.knowledge.find(id, project?.id);
  if (!project) await services.authz.requireWriteKnowledge(actor, document.package_name);
  return document;
}

function documentRoutes(app: FastifyInstance, services: Services, path: string): void {
  const { authz, knowledge, audit } = services;
  app.get<{ Querystring: { limit?: string; offset?: string } }>(path, async (request) => {
    const { visible } = await documentScope(services, request);
    const limit = Math.min(Math.max(Math.floor(Number(request.query.limit)) || 100, 1), 500);
    const offset = Math.max(Math.floor(Number(request.query.offset)) || 0, 0);
    const documents = await knowledge.list(limit, offset, visible);
    return { documents, nextOffset: documents.length === limit ? offset + limit : null };
  });
  app.get<{ Params: { id: string } }>(`${path}/:id`, async (request, reply) => {
    const { visible } = await documentScope(services, request);
    reply.header("Cache-Control", "private, no-store");
    return { document: await knowledge.get(request.params.id, visible) };
  });
  app.post<{ Body: DocumentInput }>(path, { schema: { body: createKnowledgeBody } }, async (request, reply) => {
    const { actor, project } = await documentScope(services, request, true);
    invariant(
      !project || !request.body.packageName,
      400,
      "INVALID_KNOWLEDGE_SCOPE",
      "Un documento de proyecto se guarda sin paquete",
    );
    if (!project) await authz.requireWriteKnowledge(actor, request.body.packageName);
    const document = await knowledge.add({ ...request.body, projectId: project?.id }, project?.organizationId ?? null);
    await audit.fromRequest(request, "knowledge.create", String(document.id));
    return reply.code(201).send({ document });
  });
  app.patch<{ Params: { id: string }; Body: { title?: string; content?: string; tags?: string[] } }>(
    `${path}/:id`,
    { schema: { body: updateKnowledgeBody } },
    async (request) => {
      const previous = await writableDocument(services, request, request.params.id);
      const document = await knowledge.update(request.params.id, request.body, previous.project_id ?? undefined);
      await audit.fromRequest(request, "knowledge.update", request.params.id);
      return { document };
    },
  );
  app.delete<{ Params: { id: string } }>(`${path}/:id`, async (request, reply) => {
    const previous = await writableDocument(services, request, request.params.id);
    await knowledge.delete(request.params.id, previous.project_id ?? undefined);
    await audit.fromRequest(request, "knowledge.delete", request.params.id);
    return reply.code(204).send();
  });
}

function searchRoutes(app: FastifyInstance, { authz, knowledge }: Services): void {
  app.post("/api/v1/knowledge/search", async (request) => {
    const visible = authz.packageVisibility(identityOf(request));
    const { packageVersions, ...query } = parseInput(knowledgeQuerySchema, request.body);
    return {
      results: await knowledge.search(
        query,
        packageVersions ? withPackageVersions(packageVersions, visible) : catalogKnowledge(visible),
      ),
    };
  });
  app.post<{ Body: VectorSearchBody }>(
    "/api/v1/knowledge/vector-search",
    { schema: { body: vectorSearchBody } },
    async (request) => {
      const visible = catalogKnowledge(authz.packageVisibility(identityOf(request)));
      const { embedding, model, limit, packageNames } = request.body;
      return { results: await knowledge.vectorSearch(embedding, model, limit, packageNames, visible) };
    },
  );
}

function vectorRoute(app: FastifyInstance, services: Services, path: string): void {
  const { knowledge, audit } = services;
  app.put<{ Params: { id: string }; Body: { model: string; embedding: number[]; sourceHash?: string } }>(
    `${path}/:id/vector`,
    { schema: { body: vectorBody } },
    async (request) => {
      const doc = await writableDocument(services, request, request.params.id);
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
  for (const path of ["/api/v1/knowledge/documents", "/api/v1/projects/:projectId/knowledge/documents"]) {
    documentRoutes(app, services, path);
    vectorRoute(app, services, path);
  }
  searchRoutes(app, services);
  projectKnowledgeSearchRoutes(app, services);
}
