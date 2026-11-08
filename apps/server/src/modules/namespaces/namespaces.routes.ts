import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import type { NamespaceOwner, NamespaceVisibility } from "./namespaces.service.js";

type NamespaceBody = NamespaceOwner & { description?: string; visibility?: NamespaceVisibility };

const namespaceBody = {
  organizationId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
  ownerUserId: { type: ["string", "null"], minLength: 1, maxLength: 200 },
  description: { type: "string", maxLength: 1000 },
  visibility: { type: "string", enum: ["internal", "restricted", "shared"] },
};

export async function namespacesRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { namespaces, audit } = services;
  app.get("/api/v1/namespaces", async (request) => ({
    namespaces: await namespaces.listNamespaces(identityOf(request)),
  }));
  app.post<{ Body: NamespaceBody & { name: string } }>(
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
      const namespace = await namespaces.createNamespace(identityOf(request), request.body);
      await audit.fromRequest(request, "namespace.create", namespace.name, {
        organizationId: namespace.organizationId,
        ownerUserId: namespace.ownerUserId,
        visibility: namespace.visibility,
      });
      return reply.code(201).send({ namespace });
    },
  );
  app.patch<{
    Params: { name: string };
    Body: NamespaceBody;
  }>(
    "/api/v1/namespaces/:name",
    { schema: { body: { type: "object", additionalProperties: false, properties: namespaceBody } } },
    async (request) => {
      const namespace = await namespaces.updateNamespace(identityOf(request), request.params.name, request.body ?? {});
      await audit.fromRequest(request, "namespace.update", namespace.name, request.body);
      return { namespace };
    },
  );
  app.delete<{ Params: { name: string } }>("/api/v1/namespaces/:name", async (request, reply) => {
    const namespace = await namespaces.deleteNamespace(identityOf(request), request.params.name);
    await audit.fromRequest(request, "namespace.delete", namespace.name);
    return reply.code(204).send();
  });
}
