#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { ApiClient } from "./cli/api.js";
import { loadClientConfig, loadProject } from "./cli/config.js";
import { loadLocalModels, semanticSearch } from "./client/embeddings.js";

let project: ReturnType<typeof loadProject> | undefined;
try {
  project = loadProject();
} catch {}
const global = loadClientConfig();
const serverUrl = process.env.MODAI_SERVER ?? project?.manifest.server ?? global?.server;
if (!serverUrl) {
  process.stderr.write("ModularAI MCP: configura MODAI_SERVER o ejecuta modai connect.\n");
  process.exit(1);
}
const api = new ApiClient(serverUrl, process.env.MODAI_API_TOKEN ?? global?.token);
const mcp = new McpServer({ name: "modularai", version: "0.4.0" });

const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

mcp.registerTool("modai_search_knowledge", {
  description: "Busca conocimiento relevante entre los paquetes instalados en el proyecto actual.",
  inputSchema: { query: z.string().min(1).describe("Pregunta o términos de búsqueda") },
  annotations: { readOnlyHint: true },
}, async ({ query }) => result(await api.searchKnowledge(query, project?.lock.packages.map((item) => item.name))));

mcp.registerTool("modai_recall", {
  description: "Recupera decisiones y memorias persistentes del proyecto actual.",
  inputSchema: { query: z.string().min(1) },
  annotations: { readOnlyHint: true },
}, async ({ query }) => {
  if (!project) throw new Error("El directorio actual no está inicializado con ModularAI");
  return result(await api.recall(project.manifest.projectId, query));
});

mcp.registerTool("modai_semantic_search", {
  description: "Busca conocimiento calculando el embedding en el equipo de este cliente MCP. Requiere modai client setup y modai embed index previos; no descarga modelos.",
  inputSchema: { query: z.string().min(1).max(1200) },
  annotations: { readOnlyHint: true },
}, async ({ query }) => result(await semanticSearch(api, loadLocalModels(), query, project?.lock.packages.map((p) => p.name))));

mcp.registerTool("modai_remember", {
  description: "Guarda una decisión, restricción o aprendizaje durable del proyecto. No usar para secretos ni información derivable del código.",
  inputSchema: {
    content: z.string().min(1),
    kind: z.enum(["decision", "constraint", "lesson", "note"]).default("note"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
}, async ({ content, kind }) => {
  if (!project) throw new Error("El directorio actual no está inicializado con ModularAI");
  return result(await api.remember({ projectId: project.manifest.projectId, content, kind }));
});

mcp.registerTool("modai_list_packages", {
  description: "Lista las capacidades publicadas en el registro ModularAI.",
  inputSchema: { query: z.string().optional() },
  annotations: { readOnlyHint: true },
}, async ({ query }) => result(await api.listPackages(query)));

mcp.registerTool("modai_project_status", {
  description: "Muestra capacidades directas, overrides y versiones instaladas en el proyecto actual.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => result(project ? {
  projectId: project.manifest.projectId,
  requested: project.manifest.packages,
  overrides: project.manifest.overrides ?? {},
  installed: project.lock.packages.map(({ name, version }) => ({ name, version })),
} : { initialized: false }));

await mcp.connect(new StdioServerTransport());
