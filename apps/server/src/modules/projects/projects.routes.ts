import { AppError } from "@modai/contracts/errors";
import { parseInput, projectSchema } from "@modai/contracts/schemas";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

const deleteBody = {
  type: "object",
  required: ["confirmation"],
  properties: { confirmation: { type: "string", maxLength: 200 } },
  additionalProperties: false,
};

const updateBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    organizationId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
  },
};

export async function projectsRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { projects, audit } = services;
  app.get("/api/v1/projects", async (request) => ({ projects: await projects.listProjects(identityOf(request)) }));
  app.post("/api/v1/projects", async (request, reply) => {
    const project = await projects.createProject(identityOf(request), parseInput(projectSchema, request.body));
    await audit.fromRequest(request, "project.create", project.id);
    return reply.code(201).send({ project });
  });
  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>(
    "/api/v1/projects/:id",
    { schema: { body: deleteBody } },
    async (request) => {
      if (request.body.confirmation !== request.params.id)
        throw new AppError(
          400,
          "CONFIRMATION_REQUIRED",
          "Para eliminar el proyecto, confirma escribiendo su identificador",
        );
      const result = await projects.deleteProject(identityOf(request), request.params.id);
      await audit.fromRequest(request, "project.delete", request.params.id, {
        name: result.project.name,
        memories: result.memories,
        runs: result.runs,
      });
      return { deleted: result.project, memories: result.memories, runs: result.runs };
    },
  );
  app.patch<{ Params: { id: string }; Body: { name?: string; organizationId?: string | null } }>(
    "/api/v1/projects/:id",
    { schema: { body: updateBody } },
    async (request) => {
      const project = await projects.updateProject(identityOf(request), request.params.id, request.body ?? {});
      await audit.fromRequest(request, "project.update", project.id, request.body);
      return { project };
    },
  );
}
