import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import { installationsBody } from "./packages.schemas.js";
import { UsageRepository } from "./usage.repository.js";

type InstalledPackage = { name: string; version: string; direct?: boolean };

export async function usageRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { authz, projects, database } = services;
  const usage = new UsageRepository(database);
  app.get<{ Querystring: { name: string } }>("/api/v1/packages/usage", async (request) => {
    const identity = authz.require(identityOf(request), "reader");
    const name = String(request.query.name ?? "");
    await authz.requireReadPackage(identity, name);
    const visible = new Set((await projects.listProjects(identity)).map((project) => project.id));
    const rows = await usage.byPackage(name);
    return {
      projects: rows
        .filter((row) => visible.has(row.projectId))
        .map((row) => ({ ...row, direct: Boolean(row.direct) })),
    };
  });
  app.put<{ Params: { id: string }; Body: { packages: InstalledPackage[] } }>(
    "/api/v1/projects/:id/installations",
    { schema: { body: installationsBody } },
    async (request, reply) => {
      await projects.requireProject(identityOf(request), request.params.id);
      const now = new Date().toISOString();
      await usage.replace(
        request.params.id,
        request.body.packages.map((item) => ({
          project_id: request.params.id,
          package_name: item.name,
          version: item.version,
          direct: item.direct ? 1 : 0,
          reported_at: now,
        })),
      );
      return reply.code(204).send();
    },
  );
}
