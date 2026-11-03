const query = {
  type: "object",
  properties: { query: { type: "string", minLength: 1, maxLength: 2000 } },
  required: ["query"],
  additionalProperties: false,
} as const;

export const BUILTIN_TOOLS = {
  modai_search_knowledge: {
    description:
      "Busca fragmentos relevantes del conocimiento de las dependencias fijadas del agente (con paquete y ruta de origen).",
    readOnly: true,
    inputSchema: query as Record<string, unknown>,
  },
  modai_recall: {
    description:
      "Recupera decisiones, convenciones y aprendizajes del proyecto según la política de memoria del agente.",
    readOnly: true,
    inputSchema: query as Record<string, unknown>,
  },
  modai_remember: {
    description: "Guarda una decisión o convención durable del proyecto; nunca secretos.",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", minLength: 1, maxLength: 20_000 },
        kind: { type: "string", enum: ["decision", "constraint", "lesson", "preference", "note"] },
      },
      required: ["content"],
      additionalProperties: false,
    } as Record<string, unknown>,
  },
} as const;

export type BuiltinToolName = keyof typeof BUILTIN_TOOLS;
export const BUILTIN_TOOL_NAMES = Object.keys(BUILTIN_TOOLS) as BuiltinToolName[];
export function isBuiltinTool(name: string): name is BuiltinToolName {
  return Object.hasOwn(BUILTIN_TOOLS, name);
}
