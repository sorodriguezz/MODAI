import { invariant } from "@modai/contracts/errors";
import { parseInput, runSchema, workerClaimSchema } from "@modai/contracts/schemas";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import { composeProjectAgent } from "../agents/project-agent.js";
import type { Identity } from "../auth/identity.js";
import type { ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";

const leaseBody = {
  type: "object",
  required: ["leaseToken"],
  properties: {
    leaseToken: { type: "string", minLength: 1, maxLength: 200 },
    result: { type: "string", maxLength: 1_000_000 },
    error: { type: "string", maxLength: 1_000_000 },
  },
  additionalProperties: false,
};

function runRoutes(app: FastifyInstance, services: Services): void {
  const { authz, projects, runs, audit } = services;
  app.post("/api/v1/runs", async (request, reply) => {
    const actor = authz.require(identityOf(request), "publisher"),
      input = parseInput(runSchema, request.body);
    const bundle = await composeProjectAgent(services, actor, input, true);
    const run = await runs.submit(bundle, input.task, actor.id, input.idempotencyKey);
    await audit.fromRequest(request, "run.submit", run.id, { projectId: run.projectId });
    return reply.code(201).send({ run });
  });
  app.get<{ Querystring: { projectId: string } }>("/api/v1/runs", async (request) => {
    await projects.requireProject(identityOf(request), request.query.projectId);
    return { runs: await runs.list(request.query.projectId, authz.packageVisibility(identityOf(request))) };
  });
  app.get<{ Params: { id: string } }>("/api/v1/runs/:id", async (request) => {
    const run = await runs.get(request.params.id, authz.packageVisibility(identityOf(request)));
    await projects.requireProject(identityOf(request), run.projectId);
    return { run };
  });
  app.post<{ Params: { id: string } }>("/api/v1/runs/:id/cancel", async (request) => {
    authz.require(identityOf(request), "publisher");
    const run = await runs.get(request.params.id, authz.packageVisibility(identityOf(request)));
    await projects.requireProject(identityOf(request), run.projectId, true);
    const cancelled = await runs.cancel(run.id);
    await audit.fromRequest(request, "run.cancel", run.id);
    return { run: cancelled };
  });
}

function workerRoutes(app: FastifyInstance, { authz, projects, runs, audit }: Services): void {
  const requireWorkerProject = async (actor: Identity, id: string) => {
    invariant(
      actor.role === "admin" || actor.projectIds.includes(id),
      403,
      "PROJECT_FORBIDDEN",
      "El worker requiere una asignación explícita al proyecto",
    );
    await projects.requireProject(actor, id, true);
  };
  app.post("/api/v1/worker/claim", async (request) => {
    const actor = authz.require(identityOf(request), "worker");
    const { projectId, ...worker } = parseInput(workerClaimSchema, request.body);
    await requireWorkerProject(actor, projectId);
    const claimed = await runs.claim(projectId, actor.id, { visible: authz.packageVisibility(actor), worker });
    if (claimed) await audit.fromRequest(request, "run.claim", claimed.run.id);
    return { claimed: claimed ?? null };
  });
  app.post<{ Params: { id: string }; Body: { leaseToken: string } }>(
    "/api/v1/worker/runs/:id/heartbeat",
    { schema: { body: leaseBody } },
    async (request) => {
      const actor = authz.require(identityOf(request), "worker"),
        run = await runs.get(request.params.id, authz.packageVisibility(actor));
      await requireWorkerProject(actor, run.projectId);
      return { leaseExpiresAt: await runs.heartbeat(run.id, actor.id, request.body.leaseToken) };
    },
  );
  app.post<{ Params: { id: string }; Body: { leaseToken: string; result?: string; error?: string } }>(
    "/api/v1/worker/runs/:id/finish",
    { schema: { body: leaseBody } },
    async (request) => {
      const actor = authz.require(identityOf(request), "worker"),
        run = await runs.get(request.params.id, authz.packageVisibility(actor));
      await requireWorkerProject(actor, run.projectId);
      const { leaseToken, result, error } = request.body;
      const finished = await runs.finish(run.id, actor.id, leaseToken, result, error);
      await audit.fromRequest(request, "run.finish", run.id, { status: finished.status });
      return { run: finished };
    },
  );
}

export async function runsRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  runRoutes(app, services);
  workerRoutes(app, services);
}
