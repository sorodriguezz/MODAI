import { parseInput, runSchema } from "@modai/contracts/schemas";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";

const claimBody = {
  type: "object",
  required: ["projectId"],
  properties: { projectId: { type: "string", minLength: 1, maxLength: 200 } },
  additionalProperties: false,
};

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

function runRoutes(app: FastifyInstance, { authz, projects, agents, runs, audit }: Services): void {
  app.post("/api/v1/runs", async (request, reply) => {
    const actor = authz.require(identityOf(request), "publisher"),
      input = parseInput(runSchema, request.body);
    await projects.requireProject(actor, input.projectId, true);
    await authz.requireReadPackage(actor, input.name);
    const bundle = await agents.compose(input.projectId, input.name, input.range, input.overrides);
    const run = await runs.submit(bundle, input.task, actor.id, input.idempotencyKey);
    await audit.fromRequest(request, "run.submit", run.id, { projectId: run.projectId });
    return reply.code(201).send({ run });
  });
  app.get<{ Querystring: { projectId: string } }>("/api/v1/runs", async (request) => {
    await projects.requireProject(identityOf(request), request.query.projectId);
    return { runs: await runs.list(request.query.projectId) };
  });
  app.get<{ Params: { id: string } }>("/api/v1/runs/:id", async (request) => {
    authz.require(identityOf(request), "reader");
    const run = await runs.get(request.params.id);
    await projects.requireProject(identityOf(request), run.projectId);
    return { run };
  });
  app.post<{ Params: { id: string } }>("/api/v1/runs/:id/cancel", async (request) => {
    authz.require(identityOf(request), "publisher");
    const run = await runs.get(request.params.id);
    await projects.requireProject(identityOf(request), run.projectId, true);
    const cancelled = await runs.cancel(run.id);
    await audit.fromRequest(request, "run.cancel", run.id);
    return { run: cancelled };
  });
}

function workerRoutes(app: FastifyInstance, { authz, projects, runs, audit }: Services): void {
  app.post<{ Body: { projectId: string } }>(
    "/api/v1/worker/claim",
    { schema: { body: claimBody } },
    async (request) => {
      const actor = authz.require(identityOf(request), "worker");
      await projects.requireProject(actor, request.body.projectId, true);
      const claimed = await runs.claim(request.body.projectId, actor.id);
      if (claimed) await audit.fromRequest(request, "run.claim", claimed.run.id);
      return { claimed: claimed ?? null };
    },
  );
  app.post<{ Params: { id: string }; Body: { leaseToken: string } }>(
    "/api/v1/worker/runs/:id/heartbeat",
    { schema: { body: leaseBody } },
    async (request) => {
      const actor = authz.require(identityOf(request), "worker"),
        run = await runs.get(request.params.id);
      await projects.requireProject(actor, run.projectId, true);
      return { leaseExpiresAt: await runs.heartbeat(run.id, actor.id, request.body.leaseToken) };
    },
  );
  app.post<{ Params: { id: string }; Body: { leaseToken: string; result?: string; error?: string } }>(
    "/api/v1/worker/runs/:id/finish",
    { schema: { body: leaseBody } },
    async (request) => {
      const actor = authz.require(identityOf(request), "worker"),
        run = await runs.get(request.params.id);
      await projects.requireProject(actor, run.projectId, true);
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
