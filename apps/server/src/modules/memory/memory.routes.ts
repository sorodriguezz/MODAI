import { AppError, invariant } from "@modai/contracts/errors";
import { memoryQuerySchema, memoryReviewSchema, memorySchema, parseInput } from "@modai/contracts/schemas";
import type { MemoryInput } from "@modai/contracts/types";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { Identity } from "../auth/identity.js";
import type { ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";

type ListQuery = {
  projectId: string;
  limit?: string;
  includeOrganization?: string;
  includePersonal?: string;
  includeProject?: string;
  sessionId?: string;
};

const sessionOwners = (actor: Identity) => [...new Set([actor.id, actor.personalOwnerId ?? actor.id])];

async function writableMemory({ authz, projects, memory }: Services, request: FastifyRequest, id: string) {
  const actor = authz.require(identityOf(request), "reader");
  const found = await memory.getMemory(id);
  const own = found.createdBy && sessionOwners(actor).includes(found.createdBy);
  const manages = authz.administers(actor, found.organizationId);
  if (found.scope === "organization") {
    authz.requireOrganization(actor, found.organizationId ?? undefined);
    invariant(manages || own, 403, "MEMORY_FORBIDDEN", "Solo el autor o la administración pueden editar esta memoria");
    if (!manages) await projects.requireProject(actor, found.projectId, true);
  } else {
    if ((found.personal || found.scope === "session") && !own)
      throw new AppError(404, "MEMORY_NOT_FOUND", "Memoria no encontrada");
    await projects.requireProject(actor, found.projectId, !found.personal);
  }
  return { found, actor, manages };
}

function readRoutes(app: FastifyInstance, { authz, projects, memory }: Services): void {
  app.get<{ Querystring: ListQuery }>("/api/v1/memories", async (request) => {
    const actor = authz.require(identityOf(request), "reader");
    const project = await projects.requireProject(actor, request.query.projectId);
    const includeOrganization = request.query.includeOrganization === "true";
    const organizationId = includeOrganization ? project.organizationId : undefined;
    if (includeOrganization) authz.requireOrganization(identityOf(request), organizationId);
    return {
      memories: await memory.listMemories(project.id, Number(request.query.limit) || 50, {
        organizationId,
        sessionId: request.query.sessionId,
        sessionOwners: sessionOwners(actor),
        personalOwnerId: request.query.includePersonal === "true" ? actor.personalOwnerId : undefined,
        includeProject: request.query.includeProject !== "false",
      }),
    };
  });
  app.post("/api/v1/memories/search", async (request) => {
    const actor = authz.require(identityOf(request), "reader");
    const input = parseInput(memoryQuerySchema, request.body);
    const project = await projects.requireProject(identityOf(request), input.projectId);
    const organizationId = input.includeOrganization ? project.organizationId : undefined;
    if (input.includeOrganization) authz.requireOrganization(identityOf(request), organizationId);
    return {
      results: await memory.searchMemories({
        ...input,
        organizationId: organizationId ?? undefined,
        sessionOwners: sessionOwners(actor),
        personalOwnerId: input.includePersonal ? actor.personalOwnerId : undefined,
      }),
    };
  });
}

function memoryAuthor({ authz }: Services, actor: Identity, input: MemoryInput, organizationId?: string): string {
  if (input.scope === "user")
    invariant(
      actor.personalOwnerId,
      403,
      "PERSONAL_IDENTITY_REQUIRED",
      "La memoria personal requiere una cuenta o una clave que herede sus permisos",
    );
  if (input.scope === "organization") authz.requireOrganization(actor, organizationId);
  if (input.scope === "session" && !input.sessionId)
    throw new AppError(400, "SESSION_REQUIRED", "sessionId es obligatorio");
  return input.scope === "user" || input.scope === "session" ? (actor.personalOwnerId ?? actor.id) : actor.id;
}

function writeRoutes(app: FastifyInstance, services: Services): void {
  const { authz, projects, memory, audit } = services;
  app.post<{ Body: MemoryInput }>("/api/v1/memories", async (request, reply) => {
    const actor = authz.require(identityOf(request), "reader");
    const input = parseInput(memorySchema, request.body);
    const project = await projects.requireProject(actor, input.projectId, input.scope !== "user");
    const createdBy = memoryAuthor(services, actor, input, project.organizationId);
    const approved = input.scope !== "organization" || authz.administers(actor, project.organizationId);
    const created = await memory.remember(input, createdBy, project.organizationId, {
      approval: approved ? 1 : 0,
      reviewedBy: approved && input.scope === "organization" ? actor.id : undefined,
    });
    await audit.fromRequest(request, "memory.create", String(created.id), { projectId: input.projectId });
    return reply.code(201).send({ memory: created });
  });
  app.patch<{ Params: { id: string } }>("/api/v1/memories/:id", async (request) => {
    const { found, actor, manages } = await writableMemory(services, request, request.params.id);
    const input = parseInput(memorySchema.omit({ projectId: true, sessionId: true }).partial(), request.body);
    const updated = await memory.updateMemory(
      request.params.id,
      input,
      found.scope === "organization"
        ? {
            approval: manages ? 1 : 0,
            reviewedBy: manages ? actor.id : null,
            reviewAt: null,
          }
        : undefined,
    );
    await audit.fromRequest(request, "memory.update", request.params.id);
    return { memory: updated };
  });
  app.delete<{ Params: { id: string } }>("/api/v1/memories/:id", async (request, reply) => {
    await writableMemory(services, request, request.params.id);
    await memory.deleteMemory(request.params.id);
    await audit.fromRequest(request, "memory.delete", request.params.id);
    return reply.code(204).send();
  });
}

function reviewRoutes(app: FastifyInstance, { authz, projects, memory, audit }: Services): void {
  const requireManager = (identity: Identity | undefined, organizationId?: string | null) => {
    const actor = authz.requireManager(identity);
    invariant(
      organizationId && authz.administers(actor, organizationId),
      403,
      "ORGANIZATION_FORBIDDEN",
      "No administras la organización de esta memoria",
    );
    return actor;
  };
  app.get<{ Querystring: { projectId: string } }>("/api/v1/memories/pending", async (request) => {
    const project = await projects.requireProject(identityOf(request), request.query.projectId);
    requireManager(identityOf(request), project.organizationId);
    return { memories: await memory.pending(project.organizationId!) };
  });
  app.put<{ Params: { id: string } }>("/api/v1/memories/:id/review", async (request) => {
    authz.requireManager(identityOf(request));
    const found = await memory.getMemory(request.params.id);
    invariant(found.scope === "organization", 400, "INVALID_SCOPE", "Solo se revisan memorias de organización");
    const actor = requireManager(identityOf(request), found.organizationId);
    const { approve, reviewAt } = parseInput(memoryReviewSchema, request.body);
    const review = await memory.review(request.params.id, found.updatedAt, actor.id, approve, reviewAt);
    await audit.fromRequest(request, "memory.review", request.params.id, { approve, reviewAt });
    return { review };
  });
}

export async function memoryRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  readRoutes(app, services);
  writeRoutes(app, services);
  reviewRoutes(app, services);
}
