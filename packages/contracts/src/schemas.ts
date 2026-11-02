import { z } from "zod";
import { AppError } from "./errors.js";

export const packageNameSchema = z.string().regex(/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/);
export const permissionSchema = z.enum(["project.instructions", "project.files", "process.execute", "mcp.connect"]);
export const signaturePolicySchema = z.enum(["optional", "signed", "trusted"]);
const inputSchema = z.record(z.string(), z.unknown()).refine(value => value.type === "object" && JSON.stringify(value).length <= 32000, "inputSchema debe ser un objeto JSON Schema de hasta 32 kB").default({ type: "object", properties: {}, additionalProperties: false });
export const capabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool"), name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), description: z.string().min(1).max(1000), inputSchema,
    binding: z.enum(["knowledge.search", "memory.recall", "memory.remember", "packages.list"]).or(z.string().regex(/^local:[a-z][a-z0-9_-]{0,63}$/)) }).strict(),
  z.object({ kind: z.literal("mcp"), name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), description: z.string().min(1).max(1000),
    command: z.string().min(1).max(1000), args: z.array(z.string().max(4000)).max(100).default([]), envKeys: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).max(30).default([]) }).strict(),
]);
export const agentDefinitionSchema = z.object({
  instructions: z.string().min(1).max(50_000),
  skills: z.array(packageNameSchema).max(100).default([]),
  capabilities: z.array(z.string()).max(100).default([]),
  memory: z.object({ read: z.array(z.enum(["project", "organization", "session"])).default(["project"]), write: z.boolean().default(false) }).strict().default({ read: ["project"], write: false }),
  runtime: z.object({ provider: z.literal("ollama"), model: z.string().min(1).max(200).optional() }).strict().optional(),
}).strict();
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), name: packageNameSchema, version: z.string().min(1).max(100),
  type: z.enum(["methodology", "harness", "knowledge", "skill", "memory", "tool", "adapter", "template", "mcp", "profile", "agent"]),
  description: z.string().min(1).max(5000), dependencies: z.record(packageNameSchema, z.string().max(100)).refine(value => Object.keys(value).length <= 100, "Máximo 100 dependencias").optional(),
  files: z.array(z.object({ source: z.string().min(1), target: z.string().min(1), executable: z.boolean().optional() }).strict()).max(2000).optional(),
  knowledge: z.array(z.object({ source: z.string().min(1), title: z.string().min(1), tags: z.array(z.string()).optional() }).strict()).max(1000).optional(),
  permissions: z.array(permissionSchema).max(4).optional(), capabilities: z.array(capabilitySchema).max(100).optional(),
  agent: agentDefinitionSchema.optional(), configuration: z.record(z.string(), z.unknown()).optional(),
}).strict();
export const publishSchema = z.object({ manifest: manifestSchema, files: z.array(z.object({ path: z.string().min(1), content: z.string().max(36_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(2000),
  signature: z.object({ algorithm: z.literal("ed25519"), publicKey: z.string().max(4096), signature: z.string().max(256) }).strict().optional() }).strict();
export const projectSchema = z.object({ id: z.string().min(1).max(200).optional(), name: z.string().min(1).max(200), organizationId: z.string().min(1).max(200).optional() }).strict();
export const keySchema = z.object({ label: z.string().min(1).max(200), role: z.enum(["reader", "publisher", "worker", "admin"]), projectIds: z.array(z.string().min(1).max(200)).max(200).default([]), organizationIds: z.array(z.string().min(1).max(200)).max(100).default([]), packageScopes: z.array(z.string().regex(/^(\*|@[a-z0-9][a-z0-9._-]*)$/)).max(100).default([]) }).strict();
export const memorySchema = z.object({ projectId: z.string().min(1).max(200), content: z.string().min(1).max(100_000), kind: z.string().min(1).max(100).optional(), scope: z.enum(["project", "organization", "session"]).optional(), sessionId: z.string().min(1).max(200).optional(), metadata: z.record(z.string(), z.unknown()).refine(value => JSON.stringify(value).length <= 16000, "metadata supera 16 kB").optional() }).strict();
export const memoryQuerySchema = z.object({ projectId: z.string().min(1).max(200), query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(50).optional(), includeOrganization: z.boolean().optional(), sessionId: z.string().min(1).max(200).optional() }).strict();
export const composeSchema = z.object({ projectId: z.string().min(1).max(200), name: packageNameSchema, range: z.string().max(100).default("*"), overrides: z.record(packageNameSchema, z.string()).optional() }).strict();
export const runSchema = composeSchema.extend({ task: z.string().min(1).max(50_000), idempotencyKey: z.string().min(1).max(200).optional() });
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, "INVALID_INPUT", result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
}

export const resolveSchema = z.object({ packages: z.array(z.object({ name: packageNameSchema, range: z.string().max(100).optional() }).strict()).min(1).max(100), overrides: z.record(packageNameSchema, z.string().max(100)).refine(value => Object.keys(value).length <= 200, "Máximo 200 overrides").optional() }).strict();
