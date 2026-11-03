import { z } from "zod";
import { AppError } from "./errors.js";
import { packageManifestV1Schema } from "./manifest/package.js";
import { packageNameSchema } from "./manifest/shared.js";

export { agentDefinitionSchema } from "./manifest/agent-definition.js";
export { packageNameSchema, signaturePolicySchema } from "./manifest/shared.js";

export const publishSchema = z
  .object({
    manifest: packageManifestV1Schema,
    files: z
      .array(
        z
          .object({
            path: z.string().min(1),
            content: z.string().max(36_000_000),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(2000),
    signature: z
      .object({ algorithm: z.literal("ed25519"), publicKey: z.string().max(4096), signature: z.string().max(256) })
      .strict()
      .optional(),
  })
  .strict();
export const projectSchema = z
  .object({
    id: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200),
    organizationId: z.string().min(1).max(200).optional(),
  })
  .strict();
export const keySchema = z
  .object({
    label: z.string().min(1).max(200),
    role: z.enum(["reader", "publisher", "worker", "org-admin", "admin"]),
    projectIds: z.array(z.string().min(1).max(200)).max(200).default([]),
    organizationIds: z.array(z.string().min(1).max(200)).max(100).default([]),
    packageScopes: z
      .array(z.string().regex(/^(\*|@[a-z0-9][a-z0-9._-]*)$/))
      .max(100)
      .default([]),
    ownerId: z.string().min(1).max(200).nullable().optional(),
    inherit: z.boolean().optional(),
  })
  .strict();
export const memorySchema = z
  .object({
    projectId: z.string().min(1).max(200),
    content: z.string().min(1).max(100_000),
    kind: z.string().min(1).max(100).optional(),
    scope: z.enum(["project", "organization", "session"]).optional(),
    sessionId: z.string().min(1).max(200).optional(),
    metadata: z
      .record(z.string(), z.unknown())
      .refine((value) => JSON.stringify(value).length <= 16000, "metadata supera 16 kB")
      .optional(),
  })
  .strict();
export const memoryQuerySchema = z
  .object({
    projectId: z.string().min(1).max(200),
    query: z.string().min(1).max(2000),
    limit: z.number().int().min(1).max(50).optional(),
    includeOrganization: z.boolean().optional(),
    sessionId: z.string().min(1).max(200).optional(),
  })
  .strict();
export const composeSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    name: packageNameSchema,
    range: z.string().max(100).default("*"),
    overrides: z.record(packageNameSchema, z.string()).optional(),
  })
  .strict();
export const runSchema = composeSchema.extend({
  task: z.string().min(1).max(50_000),
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      400,
      "INVALID_INPUT",
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  return result.data;
}

export const resolveSchema = z
  .object({
    packages: z
      .array(z.object({ name: packageNameSchema, range: z.string().max(100).optional() }).strict())
      .min(1)
      .max(100),
    overrides: z
      .record(packageNameSchema, z.string().max(100))
      .refine((value) => Object.keys(value).length <= 200, "Máximo 200 overrides")
      .optional(),
  })
  .strict();
