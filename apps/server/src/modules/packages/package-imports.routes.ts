import { AppError } from "@modai/contracts/errors";
import { analyzePackageQuality } from "@modai/contracts/quality";
import type { PublishPackageInput } from "@modai/contracts/types";
import { manifestIdentity, skillArchiveToPackage, templateToPackage } from "@modai/core";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import { LARGE_BODY, type ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";
import { validatedPackage } from "./package-record.js";
import { importSkillBody, importTemplateBody } from "./packages.schemas.js";

type SkillBody = { archive: string; namespace: string; version?: string; name?: string; dryRun?: boolean };
type TemplateBody = {
  name: string;
  version: string;
  description: string;
  category?: string;
  keywords?: string[];
  declaration?: { features?: Record<string, Record<string, unknown>>; addon?: { for: string[] } };
  archive?: string;
  files?: Array<{ path: string; content: string; sha256: string }>;
};

const fileSizes = (files: Array<{ path: string; content: string }>) =>
  files.map((file) => ({ path: file.path, size: Buffer.from(file.content, "base64").length }));

function convertSkill(body: SkillBody) {
  try {
    return skillArchiveToPackage(Buffer.from(body.archive, "base64"), body);
  } catch (error) {
    throw new AppError(400, "INVALID_SKILL", (error as Error).message);
  }
}

function convertTemplate({ archive, files, ...options }: TemplateBody): PublishPackageInput {
  if (!archive && !files?.length)
    throw new AppError(400, "INVALID_TEMPLATE", "Envía un ZIP (archive) o la lista de archivos");
  try {
    const source = archive
      ? { archive: Buffer.from(archive, "base64") }
      : { entries: files!.map((file) => ({ path: file.path, bytes: Buffer.from(file.content, "base64") })) };
    return templateToPackage(source, options);
  } catch (error) {
    throw new AppError(400, "INVALID_TEMPLATE", (error as Error).message);
  }
}

function skillRoute(app: FastifyInstance, { authz, packages, audit }: Services): void {
  app.post<{ Body: SkillBody }>(
    "/api/v1/packages/import-skill",
    {
      bodyLimit: LARGE_BODY,
      schema: { body: importSkillBody },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      authz.require(identityOf(request), "publisher");
      const { skill, ...input } = convertSkill(request.body);
      const name = manifestIdentity(input.manifest).name;
      if (request.body.dryRun)
        return {
          skill,
          name,
          manifest: input.manifest,
          files: fileSizes(input.files),
          quality: analyzePackageQuality(input.manifest, input.files),
        };
      await authz.requirePublish(identityOf(request), name);
      const published = await packages.publish(validatedPackage(input));
      await audit.fromRequest(request, "package.publish", `${published.name}@${published.version}`, {
        source: "skill",
        quality: published.quality?.score,
      });
      return reply.code(201).send({ package: published });
    },
  );
}

function templateRoute(app: FastifyInstance, { authz, packages, audit }: Services): void {
  app.post<{ Body: TemplateBody }>(
    "/api/v1/packages/import-template",
    { bodyLimit: LARGE_BODY, schema: { body: importTemplateBody } },
    async (request, reply) => {
      await authz.requirePublish(identityOf(request), request.body.name);
      const published = await packages.publish(validatedPackage(convertTemplate(request.body)));
      await audit.fromRequest(request, "package.publish", `${published.name}@${published.version}`, {
        source: "template",
        quality: published.quality?.score,
      });
      return reply.code(201).send({ package: published });
    },
  );
}

export async function packageImportsRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  skillRoute(app, services);
  templateRoute(app, services);
}
