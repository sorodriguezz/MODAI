import { type InstalledPackage, readStoreFile, skillFiles, type V1Project } from "@modai/core";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Ajv } from "ajv";
import type { GatewayTool } from "./context-tools.js";

type Skill = { item: InstalledPackage; skill: InstalledPackage["manifest"]["spec"]["contributes"]["skills"][number] };
const AGENT_URI = "modai://agent/active";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

export function registerToolHandlers(server: Server, tools: GatewayTool[]): void {
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validators = new Map(tools.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: "object" },
      annotations: { readOnlyHint: tool.readOnly },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const tool = tools.find((item) => item.name === request.params.name);
      if (!tool) throw new Error("Herramienta no habilitada");
      const input = request.params.arguments ?? {};
      if (!validators.get(tool.name)!(input))
        throw new Error(`Argumentos inválidos: ${ajv.errorsText(validators.get(tool.name)!.errors)}`);
      const result = await tool.call(input);
      return tool.passthrough ? (result as ReturnType<typeof text>) : text(result);
    } catch (error) {
      return { ...text({ error: (error as Error).message }), isError: true };
    }
  });
}

export function registerPromptHandlers(server: Server, instructions: string | undefined): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: instructions
      ? [
          {
            name: "modai_agent",
            description: "Aplica el agente activo a una tarea",
            arguments: [{ name: "task", description: "Tarea del proyecto", required: true }],
          },
        ]
      : [],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const task = request.params.arguments?.task;
    if (request.params.name !== "modai_agent" || !instructions || !task || task.length > 50_000)
      throw new Error("Prompt o tarea inválidos");
    return {
      description: "Agente MODAI activo",
      messages: [
        { role: "user" as const, content: { type: "text" as const, text: `${instructions}\n\n## Tarea\n\n${task}` } },
      ],
    };
  });
}

function readSkill(project: V1Project, skills: Skill[], uri: string) {
  const match = uri.match(/^modai:\/\/skills\/([a-z0-9-]+)(?:\/(.+))?$/);
  const found = match && skills.find((entry) => entry.skill.name === match[1]);
  if (!found) throw new Error("Recurso no disponible");
  const files = skillFiles(found.skill, found.item.files);
  const relative = match![2] ?? "SKILL.md";
  const file = files.find((entry) => entry.relative === relative);
  if (!file) throw new Error("Archivo de skill no encontrado");
  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text: readStoreFile(project.root, found.item.name, file.source).toString("utf8"),
      },
    ],
  };
}

export function registerResourceHandlers(
  server: Server,
  project: V1Project,
  installed: InstalledPackage[],
  instructions: string | undefined,
): void {
  const skills: Skill[] = installed.flatMap((item) =>
    item.manifest.spec.contributes.skills.map((skill) => ({ item, skill })),
  );
  const agent = instructions
    ? [
        {
          uri: AGENT_URI,
          name: "active-agent",
          description: "Instrucciones y skills del agente activo",
          mimeType: "text/markdown",
        },
      ]
    : [];
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      ...agent,
      ...skills.map(({ item, skill }) => ({
        uri: `modai://skills/${skill.name}`,
        name: skill.name,
        description: `Skill de ${item.name}@${item.version}`,
        mimeType: "text/markdown",
      })),
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === AGENT_URI && instructions)
      return { contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: instructions }] };
    return readSkill(project, skills, request.params.uri);
  });
}
