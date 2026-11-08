import { invariant } from "@modai/contracts/errors";
import { executionPolicySchema, parseInput } from "@modai/contracts/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

export async function executionPolicyRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { authz, projects, executionPolicies, audit } = services;
  const path = "/api/v1/projects/:id/execution-policy";
  const requireManager = async (request: FastifyRequest, id: string) => {
    const actor = authz.requireManager(identityOf(request));
    const project = await projects.requireProject(actor, id);
    invariant(
      authz.administers(actor, project.organizationId),
      403,
      "PROJECT_FORBIDDEN",
      "No administras este proyecto",
    );
  };
  app.get<{ Params: { id: string } }>(path, async (request) => {
    await projects.requireProject(identityOf(request), request.params.id);
    return { policy: (await executionPolicies.get(request.params.id)) ?? null };
  });
  app.put<{ Params: { id: string } }>(path, async (request) => {
    const { id } = request.params;
    await requireManager(request, id);
    const policy = parseInput(executionPolicySchema, request.body);
    await executionPolicies.set(id, policy);
    await audit.fromRequest(request, "execution-policy.set", id, policy);
    return { policy };
  });
  app.delete<{ Params: { id: string } }>(path, async (request, reply) => {
    const { id } = request.params;
    await requireManager(request, id);
    await executionPolicies.delete(id);
    await audit.fromRequest(request, "execution-policy.delete", id);
    return reply.code(204).send();
  });
}
