import { AppError } from "@modai/contracts/errors";
import { normalizeManifest, parseTemplateManifest, TEMPLATE_MANIFEST, writeZip } from "@modai/core";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

type TemplateManifest = ReturnType<typeof parseTemplateManifest> & { manifestError?: string };

function readTemplateManifest(content: string | undefined): TemplateManifest {
  if (!content) return { features: [] };
  try {
    return parseTemplateManifest(Buffer.from(content, "base64").toString("utf8"));
  } catch (error) {
    return { features: [], manifestError: (error as Error).message };
  }
}

export async function packageFilesRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { authz, packages, audit } = services;
  app.get<{ Querystring: { name: string; version?: string } }>("/api/v1/packages/template", async (request) => {
    await authz.requireReadPackage(identityOf(request), String(request.query.name ?? ""));
    const item = await packages.get(request.query.name, request.query.version);
    if (normalizeManifest(item.manifest).kind !== "Template")
      throw new AppError(400, "NOT_A_TEMPLATE", `${item.name} no es un template de proyecto`);
    const { files } = await packages.getArtifact(item.artifactId);
    const manifest = readTemplateManifest(files.find((file) => file.path === TEMPLATE_MANIFEST)?.content);
    return {
      package: item,
      ...manifest,
      files: files.map((file) => ({ path: file.path, size: Buffer.from(file.content, "base64").length })),
    };
  });
  app.get<{ Querystring: { name: string; version?: string } }>("/api/v1/packages/download", async (request, reply) => {
    await authz.requireReadPackage(identityOf(request), String(request.query.name ?? ""));
    const item = await packages.get(request.query.name, request.query.version);
    const folder = item.name.split("/")[1]!;
    const { files } = await packages.getArtifact(item.artifactId);
    const zip = writeZip(
      files.map((file) => ({ path: `${folder}/${file.path}`, bytes: Buffer.from(file.content, "base64") })),
    );
    await audit.fromRequest(request, "package.download", `${item.name}@${item.version}`);
    return reply
      .type("application/zip")
      .header("content-disposition", `attachment; filename="${folder}-${item.version}.zip"`)
      .send(zip);
  });
}
