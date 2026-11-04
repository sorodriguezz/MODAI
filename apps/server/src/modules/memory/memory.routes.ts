import { AppError } from "@modai/contracts/errors";
import { memoryQuerySchema, memorySchema, parseInput } from "@modai/contracts/schemas";
import type { MemoryInput } from "@modai/contracts/types";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";

type ListQuery = { projectId: string; limit?: string; includeOrganization?: string; sessionId?: string };

async function writableMemory({ authz, projects, memory }: Services, request: FastifyRequest, id: string) {
  authz.require(identityOf(request), "reader");
  const found = await memory.getMemory(id);
  await projects.requireProject(identityOf(request), found.projectId, true);
  if (found.scope === "organization") authz.requireOrganization(identityOf(request), found.organizationId ?? undefined);
  return found;
}

function readRoutes(app: FastifyInstance, { authz, projects, memory }: Services): void {
  app.get<{ Querystring: ListQuery }>("/api/v1/memories", async (request) => {
    const project = await projects.requireProject(identityOf(request), request.query.projectId);
    const includeOrganization = request.query.includeOrganization === "true";
    const organizationId = includeOrganization ? project.organizationId : undefined;
    if (includeOrganization) authz.requireOrganization(identityOf(request), organizationId);
    return {
      memories: await memory.listMemories(project.id, Number(request.query.limit) || 50, {
        organizationId,
        sessionId: request.query.sessionId,
      }),
    };
  });
  app.post("/api/v1/memories/search", async (request) => {
    const input = parseInput(memoryQuerySchema, request.body);
    const project = await projects.requireProject(identityOf(request), input.projectId);
    const organizationId = input.includeOrganization ? project.organizationId : undefined;
    if (input.includeOrganization) authz.requireOrganization(identityOf(request), organizationId);
    return { results: await memory.searchMemories({ ...input, organizationId: organizationId ?? undefined }) };
  });
}

function writeRoutes(app: FastifyInstance, services: Services): void {
  const { authz, projects, memory, audit } = services;
  app.post<{ Body: MemoryInput }>("/api/v1/memories", async (request, reply) => {
    const actor = authz.require(identityOf(request), "reader");
    const input = parseInput(memorySchema, request.body);
    const project = await projects.requireProject(actor, input.projectId, true);
    if (input.scope === "organization") authz.requireOrganization(actor, project.organizationId);
    if (input.scope === "session" && !input.sessionId)
      throw new AppError(400, "SESSION_REQUIRED", "sessionId es obligatorio");
    const created = await memory.remember(input, actor.id, project.organizationId);
    await audit.fromRequest(request, "memory.create", String(created.id), { projectId: input.projectId });
    return reply.code(201).send({ memory: created });
  });
  app.patch<{ Params: { id: string } }>("/api/v1/memories/:id", async (request) => {
    await writableMemory(services, request, request.params.id);
    const input = parseInput(memorySchema.omit({ projectId: true, sessionId: true }).partial(), request.body);
    const updated = await memory.updateMemory(request.params.id, input);
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

export async function memoryRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  readRoutes(app, services);
  writeRoutes(app, services);
}
