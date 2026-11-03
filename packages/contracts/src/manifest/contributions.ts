import { z } from "zod";
import { agentDefinitionSchema } from "./agent-definition.js";
import { capabilityIdSchema, contributionNameSchema, relativePathSchema } from "./shared.js";

const jsonSchemaObject = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => value.type === "object" && JSON.stringify(value).length <= 32_000,
    "inputSchema debe ser un objeto JSON Schema de hasta 32 kB",
  )
  .default({ type: "object", properties: {}, additionalProperties: false });
const commandSchema = z.string().min(1).max(1000);
const argsSchema = z.array(z.string().max(4000)).max(100).default([]);
const envKeysSchema = z
  .array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/))
  .max(30)
  .default([]);

export const toolContributionSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "Nombre de herramienta: minúsculas, números y _"),
    description: z.string().min(1).max(1000),
    inputSchema: jsonSchemaObject,
    command: commandSchema,
    args: argsSchema,
    envKeys: envKeysSchema,
    timeoutMs: z.number().int().min(100).max(600_000).default(60_000),
    readOnly: z.boolean().default(false),
    implements: capabilityIdSchema.optional(),
  })
  .strict();

export const mcpServerContributionSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    description: z.string().min(1).max(1000),
    command: commandSchema,
    args: argsSchema,
    envKeys: envKeysSchema,
  })
  .strict();

export const componentContributionSchema = z
  .object({
    name: contributionNameSchema,
    description: z.string().max(1000).optional(),
    path: relativePathSchema,
    target: relativePathSchema,
    language: z.string().max(64).optional(),
    tags: z.array(z.string().max(64)).max(50).default([]),
  })
  .strict();

const skillContributionSchema = z
  .object({
    name: contributionNameSchema,
    path: relativePathSchema,
    files: z.array(relativePathSchema).max(500).optional(),
  })
  .strict();
const ruleContributionSchema = z
  .object({ name: contributionNameSchema, path: relativePathSchema, description: z.string().max(1000).optional() })
  .strict();
const knowledgeContributionSchema = z
  .object({
    path: relativePathSchema,
    title: z.string().min(1).max(300),
    tags: z.array(z.string().max(64)).max(50).default([]),
  })
  .strict();
const fileContributionSchema = z
  .object({ source: relativePathSchema, target: relativePathSchema, executable: z.boolean().optional() })
  .strict();

export const contributesSchema = z
  .object({
    skills: z.array(skillContributionSchema).max(200).default([]),
    rules: z.array(ruleContributionSchema).max(200).default([]),
    knowledge: z.array(knowledgeContributionSchema).max(1000).default([]),
    tools: z.array(toolContributionSchema).max(100).default([]),
    mcpServers: z.array(mcpServerContributionSchema).max(20).default([]),
    agents: z
      .array(agentDefinitionSchema.extend({ name: contributionNameSchema }))
      .max(20)
      .default([]),
    components: z.array(componentContributionSchema).max(100).default([]),
    files: z.array(fileContributionSchema).max(2000).default([]),
  })
  .strict();

export type ToolContribution = z.output<typeof toolContributionSchema>;
export type McpServerContribution = z.output<typeof mcpServerContributionSchema>;
export type Contributions = z.output<typeof contributesSchema>;
export type ComponentContribution = z.output<typeof componentContributionSchema>;
