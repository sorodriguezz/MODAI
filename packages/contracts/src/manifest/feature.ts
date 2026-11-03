import { z } from "zod";
import { contributesSchema } from "./contributions.js";
import { contributionNameSchema, packageNameSchema, rangeSchema, relativePathSchema } from "./shared.js";

export const featureNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, "Usa minúsculas, números y guiones, empezando por letra (máx. 40)");

const emptyFeatureContributions = {
  skills: [],
  rules: [],
  knowledge: [],
  tools: [],
  mcpServers: [],
  components: [],
  files: [],
};

export const packageFeatureSchema = z
  .object({
    description: z.string().min(1).max(500),
    default: z.boolean().default(false),
    requires: z.array(featureNameSchema).max(50).default([]),
    conflicts: z.array(featureNameSchema).max(50).default([]),
    dependencies: z
      .record(packageNameSchema, rangeSchema)
      .refine((value) => Object.keys(value).length <= 50, "Máximo 50 dependencias")
      .default({}),
    contributes: contributesSchema.omit({ agents: true }).default(emptyFeatureContributions),
    overlays: z
      .array(z.object({ component: contributionNameSchema, path: relativePathSchema }).strict())
      .max(50)
      .default([]),
  })
  .strict();
export type PackageFeature = z.output<typeof packageFeatureSchema>;
