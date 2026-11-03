import { z } from "zod";
import { adapterDefinitionSchema } from "./adapter.js";
import { providedCapabilitySchema, requiredCapabilitySchema } from "./capability.js";
import { contributesSchema } from "./contributions.js";
import { featureNameSchema, packageFeatureSchema } from "./feature.js";
import { PERMISSIONS_V1, permissionV1Schema } from "./permissions.js";
import {
  API_VERSION,
  capabilityIdSchema,
  categorySchema,
  packageNameSchema,
  rangeSchema,
  relativePathSchema,
  semverSchema,
} from "./shared.js";

const metadataSchema = z
  .object({
    name: packageNameSchema,
    version: semverSchema,
    description: z.string().min(1).max(5000),
    license: z.string().max(100).optional(),
    authors: z.array(z.string().max(200)).max(50).optional(),
    homepage: z.string().url().max(1000).optional(),
    keywords: z.array(z.string().max(64)).max(50).optional(),
  })
  .strict();

const conflictSchema = z.union([
  z.object({ package: packageNameSchema }).strict(),
  z.object({ capability: capabilityIdSchema }).strict(),
]);

const emptyContributions = {
  skills: [],
  rules: [],
  knowledge: [],
  tools: [],
  mcpServers: [],
  agents: [],
  components: [],
  files: [],
};

const specSchema = z
  .object({
    category: categorySchema.default("general"),
    dependencies: z
      .record(packageNameSchema, rangeSchema)
      .refine((value) => Object.keys(value).length <= 100, "Máximo 100 dependencias")
      .default({}),
    provides: z.array(providedCapabilitySchema).max(100).default([]),
    requires: z.array(requiredCapabilitySchema).max(100).default([]),
    optional: z.array(requiredCapabilitySchema).max(100).default([]),
    conflicts: z.array(conflictSchema).max(100).default([]),
    permissions: z.array(permissionV1Schema).max(PERMISSIONS_V1.length).default([]),
    contributes: contributesSchema.default(emptyContributions),
    include: z.array(relativePathSchema).max(500).default([]),
    entrypoints: z
      .object({
        skills: relativePathSchema.optional(),
        knowledge: relativePathSchema.optional(),
        rules: relativePathSchema.optional(),
      })
      .strict()
      .optional(),
    adapter: adapterDefinitionSchema.optional(),
    features: z
      .record(featureNameSchema, packageFeatureSchema)
      .refine((value) => Object.keys(value).length <= 50, "Máximo 50 features")
      .default({}),
    compatibility: z
      .object({
        modai: rangeSchema.optional(),
        os: z
          .array(z.enum(["linux", "darwin", "win32"]))
          .max(3)
          .optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

type ParsedSpec = z.output<typeof specSchema>;

function templateInstallsSomething(spec: ParsedSpec): boolean {
  return (
    Object.values(spec.contributes).some((list) => list.length > 0) ||
    Object.keys(spec.dependencies).length > 0 ||
    Object.keys(spec.features).length > 0 ||
    spec.permissions.length > 0
  );
}

export const packageManifestV1Schema = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.enum(["Package", "Profile", "Adapter", "Template"]).default("Package"),
    metadata: metadataSchema,
    spec: specSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.kind === "Adapter" && !manifest.spec.adapter)
      ctx.addIssue({ code: "custom", path: ["spec", "adapter"], message: "Un paquete Adapter necesita spec.adapter" });
    if (manifest.kind !== "Adapter" && manifest.spec.adapter)
      ctx.addIssue({
        code: "custom",
        path: ["spec", "adapter"],
        message: "spec.adapter solo se admite con kind: Adapter",
      });
    if (manifest.kind === "Template" && templateInstallsSomething(manifest.spec))
      ctx.addIssue({
        code: "custom",
        path: ["spec"],
        message:
          "Un Template no instala nada en un proyecto: sin contributes, dependencies, features ni permissions (sus features van en modai.template.yaml)",
      });
  });

export type PackageManifestV1 = z.output<typeof packageManifestV1Schema>;
export type PackageManifestV1Input = z.input<typeof packageManifestV1Schema>;
