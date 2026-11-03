import { z } from "zod";
import { relativePathSchema } from "./shared.js";

export const UNSAFE_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MCP_COMMAND_KEYS = ["command", "cmd", "executable", "program", "bin"];
const GATEWAY_COMMAND = "modai-mcp";

function jsonShapeProblem(node: unknown, depth: number): string | undefined {
  if (depth > 4) return "value tiene demasiados niveles";
  if (typeof node === "string") return node.length > 500 ? "value contiene textos demasiado largos" : undefined;
  if (node === null || typeof node !== "object") return undefined;
  for (const [key, child] of Object.entries(node)) {
    if (UNSAFE_JSON_KEYS.has(key)) return `value no admite la clave ${key}`;
    const problem = jsonShapeProblem(child, depth + 1);
    if (problem) return problem;
  }
  return undefined;
}

const isStringList = (value: unknown[]) => value.every((item) => typeof item === "string");

function gatewayCommandProblem(record: Record<string, unknown>): string | undefined {
  const commands = MCP_COMMAND_KEYS.filter((key) => key in record);
  if (!commands.length)
    return `value debe indicar el comando (${MCP_COMMAND_KEYS.join(", ")}) con "${GATEWAY_COMMAND}"`;
  for (const key of commands) {
    const command = record[key];
    const list = Array.isArray(command) ? command : [command];
    if (list[0] !== GATEWAY_COMMAND || !isStringList(list))
      return `value.${key} debe ser "${GATEWAY_COMMAND}" (o una lista de textos que empiece por él): un adaptador solo registra el gateway de MODAI`;
  }
  return undefined;
}

function hasEnvironmentKey(node: unknown): boolean {
  return (
    Boolean(node) &&
    typeof node === "object" &&
    Object.entries(node as object).some(([key, child]) => /^(env|environment)$/i.test(key) || hasEnvironmentKey(child))
  );
}

export function mcpGatewayValueProblem(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "value debe ser un objeto";
  const shape = jsonShapeProblem(value, 0);
  if (shape) return shape;
  const record = value as Record<string, unknown>;
  const command = gatewayCommandProblem(record);
  if (command) return command;
  if (record.args !== undefined && (!Array.isArray(record.args) || !isStringList(record.args)))
    return "value.args debe ser una lista de textos";
  if (hasEnvironmentKey(record)) return "value no admite env: el gateway recibe su entorno del cliente";
  return undefined;
}

const blockTarget = z.object({ mode: z.literal("block"), file: relativePathSchema }).strict();
const fileTarget = z
  .object({ mode: z.literal("file"), path: relativePathSchema, header: z.string().max(4000).optional() })
  .strict();
const mcpTarget = z
  .object({
    file: relativePathSchema,
    pointer: z
      .string()
      .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
      .refine(
        (pointer) => pointer.split(".").every((key) => !UNSAFE_JSON_KEYS.has(key)),
        "pointer no admite __proto__, constructor ni prototype",
      )
      .default("mcpServers.modai"),
    value: z
      .unknown()
      .optional()
      .superRefine((value, ctx) => {
        const problem = mcpGatewayValueProblem(value);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
  })
  .strict();

export const adapterDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    description: z.string().min(1).max(1000),
    targets: z
      .object({
        skills: z.object({ path: relativePathSchema }).strict().optional(),
        rules: z.union([blockTarget, fileTarget]).optional(),
        index: blockTarget.optional(),
        mcp: mcpTarget.optional(),
      })
      .strict(),
  })
  .strict();
export type AdapterDefinition = z.output<typeof adapterDefinitionSchema>;
