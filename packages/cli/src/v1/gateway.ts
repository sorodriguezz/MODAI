import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import {
  CORE_VERSION, inspectWorkspace, loadContextIndex, loadGrants, loadV1Project, mcpServerLaunch, readKnowledgeChunk, readStoreFile, runTool,
  searchKnowledge, skillFiles, type InstalledPackage,
} from "@modai/core";
import { memoryProvider } from "./runtime.js";
import { agentInstructions, loadActivation, verifyBundle } from "../agent/activation.js";
import { CapabilityHost } from "../agent/capabilities.js";
import { installationPolicy } from "../agent/trust.js";
import { serverClient, serverProject } from "../agent/project.js";
import { runtimeOptions } from "../cli/agent-commands.js";

interface GatewayTool { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean; passthrough?: boolean; call: (input: Record<string, unknown>) => Promise<unknown> }

/**
 * One MCP server per project. It exposes the Context Gateway (knowledge, memory, skills) and the
 * executable contributions of installed packages — only those authorised on this machine and whose
 * extracted content still matches modai.lock.
 */
export async function startV1Gateway(root: string): Promise<void> {
  const project = loadV1Project(root);
  const installed = inspectWorkspace(project);
  const grants = loadGrants(project.root);
  const memory = memoryProvider(project);
  const query = { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 2000 }, packages: { type: "array", items: { type: "string" }, maxItems: 20 }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"], additionalProperties: false };
  const tools: GatewayTool[] = [
    { name: "modai_search_knowledge", readOnly: true, inputSchema: query, description: "Busca fragmentos relevantes del conocimiento instalado (con paquete, versión y ruta de origen). Úsalo en lugar de cargar documentos completos.",
      call: async input => searchKnowledge(loadContextIndex(project.root), input.query as string, { packages: input.packages as string[] | undefined, limit: input.limit as number | undefined }) },
    { name: "modai_read_knowledge", readOnly: true, description: "Devuelve el texto completo de un fragmento por su id (obtenido con modai_search_knowledge).",
      inputSchema: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 1000 } }, required: ["id"], additionalProperties: false },
      call: async input => readKnowledgeChunk(loadContextIndex(project.root), input.id as string) ?? { error: "Fragmento no encontrado" } },
    { name: "modai_list_capabilities", readOnly: true, description: "Capacidades instaladas: quién proporciona cada contrato, skills, herramientas y su estado de autorización.", inputSchema: { type: "object", properties: {}, additionalProperties: false },
      call: async () => ({ capabilities: project.lock.capabilities, packages: installed.map(item => ({ name: item.name, version: item.version, category: item.category, provides: item.manifest.spec.provides,
        skills: item.manifest.spec.contributes.skills.map(skill => `modai://skills/${skill.name}`), tools: item.manifest.spec.contributes.tools.map(tool => ({ name: tool.name, implements: tool.implements, enabled: item.authorization.allowed && item.verified })),
        ...(item.authorization.allowed ? {} : { authorization: item.authorization.reason }) })) }) },
    { name: "modai_project_status", readOnly: true, description: "Identidad del proyecto y versiones fijadas en modai.lock.", inputSchema: { type: "object", properties: {}, additionalProperties: false },
      call: async () => ({ project: project.file.name, dependencies: project.file.dependencies, installed: Object.fromEntries(Object.entries(project.lock.packages).map(([name, item]) => [name, item.version])), memory: project.file.context.memory }) },
  ];
  if (memory) {
    tools.push(
      { name: "modai_recall", readOnly: true, inputSchema: query, description: "Recupera decisiones, convenciones y preferencias guardadas para este proyecto.", call: async input => memory.recall(input.query as string, input.limit as number | undefined) },
      { name: "modai_remember", readOnly: false, description: "Guarda una decisión o convención durable del proyecto. Nunca guardes secretos.",
        inputSchema: { type: "object", properties: { content: { type: "string", minLength: 1, maxLength: 20000 }, kind: { type: "string", enum: ["decision", "constraint", "lesson", "preference", "note"] } }, required: ["content"], additionalProperties: false },
        call: async input => memory.remember({ content: input.content as string, kind: (input.kind as string) ?? "note" }) },
    );
  }
  // An activated agent exposes exactly its selected capabilities: generic memory and search tools
  // must not bypass the agent's memory policy.
  let host: CapabilityHost | undefined;
  let activeInstructions: string | undefined;
  // MCP servers the active agent selected run under the agent's own approvals (host), not a second time here.
  const agentServers = new Set<string>();
  if (existsSync(join(project.root, ".modai", "activation.json"))) {
    const activation = loadActivation(project.root);
    const target = serverProject(project.root), api = serverClient(target);
    await verifyBundle(api, activation.bundle, await installationPolicy(api, target));
    activeInstructions = agentInstructions(activation.bundle);
    for (const capability of activation.bundle.capabilities) if (capability.kind === "mcp") agentServers.add(`${capability.package}:${capability.name}`);
    host = new CapabilityHost(api, activation.bundle, { ...runtimeOptions({}, activation), cwd: project.root });
    await host.start();
    for (let index = tools.length - 1; index >= 0; index--) if (["modai_remember", "modai_recall", "modai_search_knowledge"].includes(tools[index].name)) tools.splice(index, 1);
  }
  const reserved = new Set(tools.map(tool => tool.name));
  for (const tool of host?.list() ?? []) {
    if (reserved.has(tool.name)) throw new Error(`Colisión con herramienta reservada: ${tool.name}`);
    reserved.add(tool.name);
    tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Record<string, unknown>, readOnly: false, call: input => host!.call(tool.name, input) });
  }
  const clients: Client[] = [];
  const enabled = (item: InstalledPackage) => item.authorization.allowed && item.verified;
  for (const item of installed.filter(enabled)) {
    for (const tool of item.manifest.spec.contributes.tools) {
      if (reserved.has(tool.name)) throw new Error(`Colisión con herramienta reservada: ${tool.name}`);
      reserved.add(tool.name);
      tools.push({ name: tool.name, readOnly: tool.readOnly, inputSchema: tool.inputSchema, description: `${tool.description} [${item.name}${tool.implements ? ` · ${tool.implements}` : ""}]`,
        call: input => runTool(tool, input, { packageDir: item.packageDir, projectDir: project.root, grant: grants.packages[item.name] }) });
    }
    for (const server of item.manifest.spec.contributes.mcpServers) {
      if (agentServers.has(`${item.name}:${server.name}`)) continue;
      const launch = mcpServerLaunch(server, { packageDir: item.packageDir, projectDir: project.root, grant: grants.packages[item.name] });
      const client = new Client({ name: "modai-gateway", version: CORE_VERSION });
      const transport = new StdioClientTransport({ ...launch, env: { ...getDefaultEnvironment(), ...launch.env }, stderr: "pipe" });
      transport.stderr?.on("data", () => {});
      await client.connect(transport);
      clients.push(client);
      const listed = await client.listTools();
      for (const remote of listed.tools.slice(0, 100)) {
        const name = `${server.name}__${remote.name}`.slice(0, 64);
        if (reserved.has(name)) throw new Error(`Colisión de herramientas: ${name}`);
        reserved.add(name);
        tools.push({ name, readOnly: Boolean(remote.annotations?.readOnlyHint), inputSchema: remote.inputSchema as Record<string, unknown>, description: `${server.description}: ${remote.description ?? remote.name} [${item.name}]`,
          passthrough: true, call: input => client.callTool({ name: remote.name, arguments: input }) });
      }
    }
  }

  const skills = installed.flatMap(item => item.manifest.spec.contributes.skills.map(skill => ({ item, skill })));
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validators = new Map(tools.map(tool => [tool.name, ajv.compile(tool.inputSchema)]));
  const server = new Server({ name: "modai", version: CORE_VERSION }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as { type: "object" }, annotations: { readOnlyHint: tool.readOnly } })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const tool = tools.find(item => item.name === request.params.name);
      if (!tool) throw new Error("Herramienta no habilitada");
      const input = request.params.arguments ?? {};
      if (!validators.get(tool.name)!(input)) throw new Error(`Argumentos inválidos: ${ajv.errorsText(validators.get(tool.name)!.errors)}`);
      const result = await tool.call(input);
      // Tool output is data, never instructions that can widen permissions.
      return tool.passthrough ? result as ReturnType<typeof text> : text(result);
    } catch (error) { return { ...text({ error: (error as Error).message }), isError: true }; }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      ...(activeInstructions ? [{ uri: "modai://agent/active", name: "active-agent", description: "Instrucciones y skills del agente activo", mimeType: "text/markdown" }] : []),
      ...skills.map(({ item, skill }) => ({ uri: `modai://skills/${skill.name}`, name: skill.name, description: `Skill de ${item.name}@${item.version}`, mimeType: "text/markdown" })),
    ],
  }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: activeInstructions ? [{ name: "modai_agent", description: "Aplica el agente activo a una tarea", arguments: [{ name: "task", description: "Tarea del proyecto", required: true }] }] : [] }));
  server.setRequestHandler(GetPromptRequestSchema, async request => {
    const task = request.params.arguments?.task;
    if (request.params.name !== "modai_agent" || !activeInstructions || !task || task.length > 50_000) throw new Error("Prompt o tarea inválidos");
    return { description: "Agente MODAI activo", messages: [{ role: "user" as const, content: { type: "text" as const, text: `${activeInstructions}\n\n## Tarea\n\n${task}` } }] };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri === "modai://agent/active" && activeInstructions) return { contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: activeInstructions }] };
    const match = request.params.uri.match(/^modai:\/\/skills\/([a-z0-9-]+)(?:\/(.+))?$/);
    const found = match && skills.find(entry => entry.skill.name === match[1]);
    if (!found) throw new Error("Recurso no disponible");
    const files = skillFiles(found.skill, found.item.files);
    const relative = match![2] ?? "SKILL.md";
    const file = files.find(entry => entry.relative === relative);
    if (!file) throw new Error("Archivo de skill no encontrado");
    return { contents: [{ uri: request.params.uri, mimeType: "text/markdown", text: readStoreFile(project.root, found.item.name, file.source).toString("utf8") }] };
  });
  const close = async () => { await Promise.allSettled([...clients.map(client => client.close()), host?.close()]); await server.close(); };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  await server.connect(new StdioServerTransport());
}
