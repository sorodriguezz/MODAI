import { AppError } from "@modai/contracts/errors";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

const organizationBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    description: { type: "string", maxLength: 1000 },
  },
};

const confirmationBody = {
  type: "object",
  required: ["confirmation"],
  properties: { confirmation: { type: "string", maxLength: 200 } },
  additionalProperties: false,
};

export async function organizationsRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { organizations, audit } = services;
  app.get("/api/v1/organizations", async (request) => ({
    organizations: await organizations.listOrganizations(identityOf(request)),
  }));
  app.post<{ Body: { name: string; description?: string } }>(
    "/api/v1/organizations",
    { schema: { body: { ...organizationBody, required: ["name"] } } },
    async (request, reply) => {
      const organization = await organizations.createOrganization(identityOf(request), request.body);
      await audit.fromRequest(request, "organization.create", organization.id, { name: organization.name });
      return reply.code(201).send({ organization });
    },
  );
  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
    "/api/v1/organizations/:id",
    { schema: { body: organizationBody } },
    async (request) => {
      const organization = await organizations.updateOrganization(
        identityOf(request),
        request.params.id,
        request.body ?? {},
      );
      await audit.fromRequest(request, "organization.update", organization.id, request.body);
      return { organization };
    },
  );
  app.delete<{ Params: { id: string }; Body: { confirmation: string } }>(
    "/api/v1/organizations/:id",
    { schema: { body: confirmationBody } },
    async (request, reply) => {
      const current = await organizations.getOrganization(identityOf(request), request.params.id);
      if (request.body.confirmation !== current.name)
        throw new AppError(
          400,
          "CONFIRMATION_REQUIRED",
          "Para eliminar la organización, confirma escribiendo su nombre",
        );
      await organizations.deleteOrganization(identityOf(request), request.params.id);
      await audit.fromRequest(request, "organization.delete", current.id, { name: current.name });
      return reply.code(204).send();
    },
  );
}
