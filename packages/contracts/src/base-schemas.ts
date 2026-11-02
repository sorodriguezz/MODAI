import { z } from "zod";

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
