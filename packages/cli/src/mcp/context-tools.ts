import {
  type InstalledPackage,
  loadContextIndex,
  type MemoryProvider,
  readKnowledgeChunk,
  searchKnowledge,
  type V1Project,
} from "@modai/core";

export interface GatewayTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  passthrough?: boolean;
  call: (input: Record<string, unknown>) => Promise<unknown>;
}

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", minLength: 1, maxLength: 2000 },
    packages: { type: "array", items: { type: "string" }, maxItems: 20 },
    limit: { type: "integer", minimum: 1, maximum: 20 },
  },
  required: ["query"],
  additionalProperties: false,
};
const NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

function listCapabilities(project: V1Project, installed: InstalledPackage[]) {
  return {
    capabilities: project.lock.capabilities,
    packages: installed.map((item) => ({
      name: item.name,
      version: item.version,
      category: item.category,
      provides: item.manifest.spec.provides,
      skills: item.manifest.spec.contributes.skills.map((skill) => `modai://skills/${skill.name}`),
      tools: item.manifest.spec.contributes.tools.map((tool) => ({
        name: tool.name,
        implements: tool.implements,
        enabled: item.authorization.allowed && item.verified,
      })),
      ...(item.authorization.allowed ? {} : { authorization: item.authorization.reason }),
    })),
  };
}

export function contextTools(project: V1Project, installed: InstalledPackage[]): GatewayTool[] {
  return [
    {
      name: "modai_search_knowledge",
      readOnly: true,
      inputSchema: QUERY_SCHEMA,
      description:
        "Busca fragmentos relevantes del conocimiento instalado (con paquete, versión y ruta de origen). Úsalo en lugar de cargar documentos completos.",
      call: async (input) =>
        searchKnowledge(loadContextIndex(project.root), input.query as string, {
          packages: input.packages as string[] | undefined,
          limit: input.limit as number | undefined,
        }),
    },
    {
      name: "modai_read_knowledge",
      readOnly: true,
      description: "Devuelve el texto completo de un fragmento por su id (obtenido con modai_search_knowledge).",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", minLength: 1, maxLength: 1000 } },
        required: ["id"],
        additionalProperties: false,
      },
      call: async (input) =>
        readKnowledgeChunk(loadContextIndex(project.root), input.id as string) ?? { error: "Fragmento no encontrado" },
    },
    {
      name: "modai_list_capabilities",
      readOnly: true,
      description:
        "Capacidades instaladas: quién proporciona cada contrato, skills, herramientas y su estado de autorización.",
      inputSchema: NO_INPUT,
      call: async () => listCapabilities(project, installed),
    },
    {
      name: "modai_project_status",
      readOnly: true,
      description: "Identidad del proyecto y versiones fijadas en modai.lock.",
      inputSchema: NO_INPUT,
      call: async () => ({
        project: project.file.name,
        dependencies: project.file.dependencies,
        installed: Object.fromEntries(
          Object.entries(project.lock.packages).map(([name, item]) => [name, item.version]),
        ),
        memory: project.file.context.memory,
      }),
    },
  ];
}

export function memoryTools(memory: MemoryProvider | undefined): GatewayTool[] {
  if (!memory) return [];
  return [
    {
      name: "modai_recall",
      readOnly: true,
      inputSchema: QUERY_SCHEMA,
      description: "Recupera decisiones, convenciones y preferencias guardadas para este proyecto.",
      call: async (input) => memory.recall(input.query as string, input.limit as number | undefined),
    },
    {
      name: "modai_remember",
      readOnly: false,
      description: "Guarda una decisión o convención durable del proyecto. Nunca guardes secretos.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", minLength: 1, maxLength: 20000 },
          kind: { type: "string", enum: ["decision", "constraint", "lesson", "preference", "note"] },
        },
        required: ["content"],
        additionalProperties: false,
      },
      call: async (input) =>
        memory.remember({ content: input.content as string, kind: (input.kind as string) ?? "note" }),
    },
  ];
}
