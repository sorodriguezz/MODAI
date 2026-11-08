import { z } from "zod";
import { featureNameSchema } from "./feature.js";
import { API_VERSION, capabilityIdSchema, packageNameSchema, rangeSchema } from "./shared.js";

export const registrySourceSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    url: z.string().url().max(1000).optional(),
    path: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.url) !== Boolean(value.path), "Cada registry necesita url o path, no ambos");

export const projectFileSchema = z
  .object({
    apiVersion: z.literal(API_VERSION),
    kind: z.literal("Project"),
    name: z.string().min(1).max(200),
    registries: z.array(registrySourceSchema).max(20).default([]),
    dependencies: z.record(packageNameSchema, z.string().min(1).max(4096)).default({}),
    overrides: z.record(packageNameSchema, rangeSchema).default({}),
    features: z.record(packageNameSchema, z.record(featureNameSchema, z.boolean())).default({}),
    providers: z.record(capabilityIdSchema, packageNameSchema).default({}),
    adapters: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
      .max(20)
      .default(["agent-skills", "mcp"]),
    signaturePolicy: z.enum(["optional", "signed", "trusted"]).optional(),
    context: z
      .object({
        memory: z.enum(["local", "remote", "off"]).default("local"),
        server: z.string().url().max(1000).optional(),
        projectId: z.string().min(1).max(200).optional(),
        delivery: z.enum(["materialized", "virtual"]).optional(),
      })
      .strict()
      .refine(
        (context) => !context.delivery || (context.server && context.projectId),
        "La entrega central requiere server y projectId",
      )
      .default({ memory: "local" }),
  })
  .strict();
export type ProjectFile = z.output<typeof projectFileSchema>;
export type RegistrySource = z.output<typeof registrySourceSchema>;
