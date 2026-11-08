import { z } from "zod";

const managedFileSchema = z
  .object({
    type: z.literal("file"),
    path: z.string(),
    sha256: z.string(),
    owner: z.string(),
    adapter: z.string().optional(),
    userSha256: z.string().optional(),
  })
  .strict();
const managedBlockSchema = z
  .object({
    type: z.literal("block"),
    path: z.string(),
    id: z.string(),
    sha256: z.string(),
    owners: z.array(z.string()),
    adapter: z.string().optional(),
  })
  .strict();
const managedJsonSchema = z
  .object({
    type: z.literal("json"),
    path: z.string(),
    pointer: z.string(),
    sha256: z.string(),
    adapter: z.string().optional(),
  })
  .strict();
export const managedEntrySchema = z.discriminatedUnion("type", [
  managedFileSchema,
  managedBlockSchema,
  managedJsonSchema,
]);
export type ManagedEntry = z.output<typeof managedEntrySchema>;

export const lockedPackageSchema = z
  .object({
    version: z.string(),
    source: z.string(),
    integrity: z.string().regex(/^sha256-[a-f0-9]{64}$/),
    signer: z.string().optional(),
    kind: z.enum(["Package", "Profile", "Adapter", "Template"]),
    category: z.string(),
    dependencies: z.record(z.string(), z.string()).default({}),
    provides: z.array(z.string()).default([]),
    requires: z.record(z.string(), z.string()).default({}),
    permissions: z.array(z.string()).default([]),
    features: z.array(z.string()).default([]),
  })
  .strict();
export type LockedPackageV1 = z.output<typeof lockedPackageSchema>;

export const lockFileSchema = z
  .object({
    lockfileVersion: z.literal(1),
    profileDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    packages: z.record(z.string(), lockedPackageSchema).default({}),
    capabilities: z.record(z.string(), z.object({ provider: z.string(), version: z.string() }).strict()).default({}),
    managed: z.array(managedEntrySchema).default([]),
  })
  .strict();
export type LockFile = z.output<typeof lockFileSchema>;
