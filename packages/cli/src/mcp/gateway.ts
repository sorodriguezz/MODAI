import { CORE_VERSION, inspectWorkspace, loadGrants, loadV1Project } from "@modai/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { memoryProvider, RemoteMemoryProvider } from "../services/memory.js";
import { profileConnection } from "../services/profile.js";
import { hostTools, startActiveAgent } from "./agent-tools.js";
import { contextTools, memoryTools, remoteProfileTools } from "./context-tools.js";
import { registerPromptHandlers, registerResourceHandlers, registerToolHandlers } from "./handlers.js";
import { packageTools } from "./package-tools.js";

export async function startGateway(root: string): Promise<void> {
  const project = loadV1Project(root);
  const installed = inspectWorkspace(project);
  const grants = loadGrants(project.root);
  const memory = memoryProvider(project);
  const tools = [...contextTools(project, installed), ...memoryTools(memory)];
  if (project.file.context.delivery)
    tools.push(...remoteProfileTools(profileConnection(undefined, project.file.context), project.file.signaturePolicy));
  const agent = await startActiveAgent(project, tools);
  const reserved = new Set(tools.map((tool) => tool.name));
  tools.push(...hostTools(agent.host, reserved));
  const clients: Client[] = [];
  tools.push(
    ...(await packageTools(installed, {
      project,
      grants: grants.packages,
      reserved,
      agentServers: agent.servers,
      clients,
    })),
  );
  const server = new Server(
    { name: "modai", version: CORE_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  registerToolHandlers(server, tools);
  registerResourceHandlers(server, project, installed, agent.instructions);
  registerPromptHandlers(server, agent.instructions);
  const close = async () => {
    await Promise.allSettled([...clients.map((client) => client.close()), agent.host?.close()]);
    await server.close();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  await server.connect(new StdioServerTransport());
}

export async function startVirtualGateway(projectId: string): Promise<void> {
  const connection = profileConnection(projectId, { memory: "off" });
  const server = new Server({ name: "modai", version: CORE_VERSION }, { capabilities: { tools: {} } });
  registerToolHandlers(server, [
    ...remoteProfileTools(connection),
    ...memoryTools(new RemoteMemoryProvider(connection.api, connection.id)),
  ]);
  await server.connect(new StdioServerTransport());
}
