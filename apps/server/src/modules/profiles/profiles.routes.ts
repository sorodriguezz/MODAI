import {
  bindingSlotSchema,
  capabilityBindingSchema,
  parseInput,
  profilePlatformSchema,
} from "@modai/contracts/schemas";
import type { BindingTarget } from "@modai/contracts/types";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

const routes = { organization: "organizations", project: "projects", team: "teams" } as const;

export async function profilesRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { profiles, authz, projects, audit } = services;
  app.get<{ Params: { id: string }; Querystring: { platform?: string } }>(
    "/api/v1/projects/:id/effective-profile",
    async (request, reply) => {
      const actor = authz.require(identityOf(request), "reader");
      const project = await projects.requireProject(actor, request.params.id);
      const platform = parseInput(profilePlatformSchema, request.query.platform);
      reply.header("Cache-Control", "private, no-store");
      return { profile: await profiles.resolve(actor, project, platform) };
    },
  );
  for (const scope of Object.keys(routes) as Array<BindingTarget["scope"]>) {
    const path = `/api/v1/${routes[scope]}/:id/bindings`;
    app.get<{ Params: { id: string } }>(path, async (request) => ({
      bindings: await profiles.list(identityOf(request), { scope, id: request.params.id }),
    }));
    app.put<{ Params: { id: string } }>(path, async (request) => {
      const input = parseInput(capabilityBindingSchema, request.body);
      const binding = await profiles.set(identityOf(request), { scope, id: request.params.id }, input);
      await audit.fromRequest(request, "binding.set", request.params.id, { scope, ...input });
      return { binding };
    });
    app.delete<{ Params: { id: string; slot: string } }>(`${path}/:slot`, async (request, reply) => {
      const slot = parseInput(bindingSlotSchema, request.params.slot);
      await profiles.delete(identityOf(request), { scope, id: request.params.id }, slot);
      await audit.fromRequest(request, "binding.delete", request.params.id, { scope, slot });
      return reply.code(204).send();
    });
  }
}
