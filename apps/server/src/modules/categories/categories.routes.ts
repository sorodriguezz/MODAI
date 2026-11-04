import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

const createBody = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: { type: "string", maxLength: 64 }, description: { type: "string", maxLength: 500 } },
};
const updateBody = {
  type: "object",
  additionalProperties: false,
  properties: { description: { type: "string", maxLength: 500 } },
};

export async function categoriesRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { authz, categories, audit } = services;
  app.get("/api/v1/categories", async (request) => ({
    categories: await categories.list(await authz.packageReader(identityOf(request))),
  }));
  app.post<{ Body: { name: string; description?: string } }>(
    "/api/v1/categories",
    { schema: { body: createBody } },
    async (request, reply) => {
      authz.require(identityOf(request), "admin");
      const category = await categories.create(request.body);
      await audit.fromRequest(request, "category.create", category.name);
      return reply.code(201).send({ category });
    },
  );
  app.patch<{ Params: { name: string }; Body: { description?: string } }>(
    "/api/v1/categories/:name",
    { schema: { body: updateBody } },
    async (request) => {
      authz.require(identityOf(request), "admin");
      const category = await categories.update(request.params.name, request.body);
      await audit.fromRequest(request, "category.update", category.name);
      return { category };
    },
  );
  app.delete<{ Params: { name: string } }>("/api/v1/categories/:name", async (request, reply) => {
    authz.require(identityOf(request), "admin");
    await categories.remove(request.params.name);
    await audit.fromRequest(request, "category.delete", request.params.name);
    return reply.code(204).send();
  });
}
