import { analyzePackageQuality } from "@modai/contracts/quality";
import { parseInput, resolveSchema } from "@modai/contracts/schemas";
import type { PublishPackageInput, ResolveRequest } from "@modai/contracts/types";
import { manifestIdentity } from "@modai/core";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import { LARGE_BODY, type ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";
import { catalog, summary } from "./catalog.js";
import { validatedPackage } from "./package-record.js";

type CatalogQuery = { q?: string; type?: string; category?: string; status?: string; limit?: string; offset?: string };

function readRoutes(app: FastifyInstance, { authz, packages }: Services): void {
  app.get<{ Querystring: { q?: string; type?: string; includeYanked?: string; name?: string } }>(
    "/api/v1/packages",
    async (request) => {
      const visible = await authz.packageReader(identityOf(request));
      const { name, q, type, includeYanked } = request.query;
      const list = (await packages.list(name ?? q, type, includeYanked === "true")).filter((item) =>
        visible(item.name),
      );
      return { packages: name ? list.filter((item) => item.name === name) : list };
    },
  );
  app.get<{ Querystring: CatalogQuery }>("/api/v1/packages/catalog", async (request) => {
    const visible = await authz.packageReader(identityOf(request));
    const { limit, offset, ...filters } = request.query;
    return catalog(packages, {
      ...filters,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      visible,
    });
  });
  app.get("/api/v1/packages/summary", async (request) =>
    summary(packages, await authz.packageReader(identityOf(request))),
  );
  app.get<{ Querystring: { name: string; version?: string } }>("/api/v1/package", async (request) => {
    await authz.requireReadPackage(identityOf(request), String(request.query.name ?? ""));
    return { package: await packages.get(request.query.name, request.query.version) };
  });
  app.get<{ Params: { id: string } }>("/api/v1/artifacts/:id", async (request) => {
    const owner = await packages.artifactOwner(request.params.id);
    if (owner) await authz.requireReadPackage(identityOf(request), owner);
    else authz.require(identityOf(request), "admin");
    return packages.getArtifact(request.params.id);
  });
}

function writeRoutes(app: FastifyInstance, { authz, packages, audit }: Services): void {
  app.post<{ Body: PublishPackageInput }>(
    "/api/v1/packages/validate",
    { bodyLimit: LARGE_BODY, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request) => {
      authz.require(identityOf(request), "publisher");
      const input = validatedPackage(request.body);
      return { quality: analyzePackageQuality(input.manifest, input.files) };
    },
  );
  app.post<{ Body: PublishPackageInput }>("/api/v1/packages", { bodyLimit: LARGE_BODY }, async (request, reply) => {
    const input = validatedPackage(request.body);
    const name = manifestIdentity(input.manifest).name;
    await authz.requirePublish(identityOf(request), name);
    const published = await packages.publish(input);
    await audit.fromRequest(request, "package.publish", `${published.name}@${published.version}`, {
      signed: Boolean(request.body.signature),
      quality: published.quality?.score,
    });
    return reply.code(201).send({ package: published });
  });
  app.post<{ Body: ResolveRequest }>("/api/v1/resolve", async (request) => {
    const visible = await authz.packageReader(identityOf(request));
    const input = parseInput(resolveSchema, request.body);
    return { packages: await packages.resolve(input, visible) };
  });
}

export async function packagesRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  readRoutes(app, services);
  writeRoutes(app, services);
}
