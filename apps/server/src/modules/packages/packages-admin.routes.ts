import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";
import { deleteBody, deprecateBody, registerPublisherBody, trustPublisherBody, yankBody } from "./packages.schemas.js";

function versionRoutes(app: FastifyInstance, { authz, packages, audit }: Services): void {
  app.post<{ Body: { name: string; version: string; message: string } }>(
    "/api/v1/admin/packages/deprecate",
    { schema: { body: deprecateBody } },
    async (request) => {
      await authz.requireManagePackage(identityOf(request), String(request.body?.name ?? ""));
      const item = await packages.deprecate(request.body.name, request.body.version, request.body.message);
      await audit.fromRequest(request, "package.deprecate", `${item.name}@${item.version}`, {
        message: request.body.message,
      });
      return { package: item };
    },
  );
  app.post<{ Body: { name: string; version: string; reason: string } }>(
    "/api/v1/admin/packages/yank",
    { schema: { body: yankBody } },
    async (request) => {
      await authz.requireManagePackage(identityOf(request), String(request.body?.name ?? ""));
      const item = await packages.yank(request.body.name, request.body.version, request.body.reason);
      await audit.fromRequest(request, "package.yank", `${item.name}@${item.version}`, { reason: request.body.reason });
      return { package: item };
    },
  );
  app.delete<{ Body: { name: string; version: string; confirmation: string } }>(
    "/api/v1/admin/packages",
    { schema: { body: deleteBody } },
    async (request, reply) => {
      authz.require(identityOf(request), "admin");
      await packages.hardDelete(request.body.name, request.body.version, request.body.confirmation);
      await audit.fromRequest(request, "package.delete", request.body.confirmation);
      return reply.code(204).send();
    },
  );
}

function publisherRoutes(app: FastifyInstance, { authz, packages, audit }: Services): void {
  app.get("/api/v1/admin/publishers", async (request) => {
    authz.require(identityOf(request), "admin");
    return { publishers: await packages.listPublishers() };
  });
  app.post<{ Body: { publicKey: string; label: string; trusted: boolean } }>(
    "/api/v1/admin/publishers",
    { schema: { body: registerPublisherBody } },
    async (request) => {
      authz.require(identityOf(request), "admin");
      const { publicKey, label, trusted } = request.body;
      const fingerprint = await packages.registerPublisher(publicKey, label, trusted);
      await audit.fromRequest(request, "publisher.register", fingerprint);
      return { fingerprint };
    },
  );
  app.patch<{ Params: { fingerprint: string }; Body: { trusted: boolean; label?: string } }>(
    "/api/v1/admin/publishers/:fingerprint",
    { schema: { body: trustPublisherBody } },
    async (request) => {
      authz.require(identityOf(request), "admin");
      await packages.trustPublisher(request.params.fingerprint, request.body.trusted, request.body.label);
      await audit.fromRequest(request, "publisher.trust", request.params.fingerprint, request.body);
      return { ok: true };
    },
  );
}

export async function packagesAdminRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  versionRoutes(app, services);
  publisherRoutes(app, services);
}
