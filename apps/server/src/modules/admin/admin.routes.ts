import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import type { Snapshot } from "./backup-snapshot.js";

type PruneBody = { memoryDays?: number; auditDays?: number; dryRun?: boolean };

const pruneBody = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    memoryDays: { type: "integer", minimum: 0, maximum: 36500 },
    auditDays: { type: "integer", minimum: 0, maximum: 36500 },
    dryRun: { type: "boolean" },
  },
};

export async function adminRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { authz, audit, backup, memory } = services;
  app.get<{ Querystring: { limit?: string } }>("/api/v1/admin/audit", async (request) => {
    authz.require(identityOf(request), "admin");
    return { events: await audit.list(Number(request.query.limit) || 100) };
  });
  app.get("/api/v1/admin/export", async (request) => {
    authz.require(identityOf(request), "admin");
    await audit.fromRequest(request, "backup.export", "server");
    return backup.export();
  });
  app.post<{ Body: Snapshot }>("/api/v1/admin/import", { bodyLimit: 1024 * 1024 * 1024 }, async (request) => {
    authz.require(identityOf(request), "admin");
    const result = await backup.import(request.body);
    await audit.fromRequest(request, "backup.import", "server", result);
    return result;
  });
  app.post<{ Body: PruneBody }>("/api/v1/admin/prune", { schema: { body: pruneBody } }, async (request) => {
    authz.require(identityOf(request), "admin");
    const body = request.body ?? {};
    const usesDefaults = body.memoryDays === undefined && body.auditDays === undefined;
    const memoryDays = usesDefaults ? 365 : body.memoryDays,
      auditDays = usesDefaults ? 90 : body.auditDays,
      dryRun = body.dryRun === true;
    const result = {
      memories: memoryDays === undefined ? 0 : await memory.pruneMemories(memoryDays, dryRun),
      audit: auditDays === undefined ? 0 : await audit.prune(auditDays, dryRun),
      dryRun,
    };
    if (!dryRun) await audit.fromRequest(request, "retention.prune", "server", { ...result, memoryDays, auditDays });
    return result;
  });
}
