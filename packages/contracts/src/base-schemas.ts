import { z } from "zod";

export const packageNameSchema = z.string().regex(/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/);
export const signaturePolicySchema = z.enum(["optional", "signed", "trusted"]);
export const agentDefinitionSchema = z.object({
  instructions: z.string().min(1).max(50_000),
  skills: z.array(packageNameSchema).max(100).default([]),
  /**
   * Tools the agent may use: MODAI built-in tools (modai_search_knowledge, modai_recall,
   * modai_remember) or the name of an MCP server contributed by a package it depends on.
   */
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(100).default([]),
  memory: z.object({ read: z.array(z.enum(["project", "organization", "session"])).default(["project"]), write: z.boolean().default(false) }).strict().default({ read: ["project"], write: false }),
  runtime: z.object({ provider: z.literal("ollama"), model: z.string().min(1).max(200).optional() }).strict().optional(),
}).strict();
