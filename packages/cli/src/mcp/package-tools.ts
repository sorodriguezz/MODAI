import {
  CORE_VERSION,
  type InstalledPackage,
  type loadGrants,
  mcpServerLaunch,
  runTool,
  type V1Project,
} from "@modai/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { GatewayTool } from "./context-tools.js";

type Grants = ReturnType<typeof loadGrants>["packages"];
type McpServer = InstalledPackage["manifest"]["spec"]["contributes"]["mcpServers"][number];

export interface PackageToolContext {
  project: V1Project;
  grants: Grants;
  reserved: Set<string>;
  agentServers: Set<string>;
  clients: Client[];
}

function claim(reserved: Set<string>, name: string, message: string): void {
  if (reserved.has(name)) throw new Error(`${message}: ${name}`);
  reserved.add(name);
}

function executableTools(item: InstalledPackage, context: PackageToolContext): GatewayTool[] {
  return item.manifest.spec.contributes.tools.map((tool) => {
    claim(context.reserved, tool.name, "Colisión con herramienta reservada");
    return {
      name: tool.name,
      readOnly: tool.readOnly,
      inputSchema: tool.inputSchema,
      description: `${tool.description} [${item.name}${tool.implements ? ` · ${tool.implements}` : ""}]`,
      call: (input) =>
        runTool(tool, input, {
          packageDir: item.packageDir,
          projectDir: context.project.root,
          grant: context.grants[item.name],
        }),
    };
  });
}

async function proxiedTools(
  item: InstalledPackage,
  server: McpServer,
  context: PackageToolContext,
): Promise<GatewayTool[]> {
  const launch = mcpServerLaunch(server, {
    packageDir: item.packageDir,
    projectDir: context.project.root,
    grant: context.grants[item.name],
  });
  const client = new Client({ name: "modai-gateway", version: CORE_VERSION });
  const transport = new StdioClientTransport({
    ...launch,
    env: { ...getDefaultEnvironment(), ...launch.env },
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {});
  await client.connect(transport);
  context.clients.push(client);
  const listed = await client.listTools();
  return listed.tools.slice(0, 100).map((remote) => {
    const name = `${server.name}__${remote.name}`.slice(0, 64);
    claim(context.reserved, name, "Colisión de herramientas");
    return {
      name,
      readOnly: Boolean(remote.annotations?.readOnlyHint),
      inputSchema: remote.inputSchema as Record<string, unknown>,
      description: `${server.description}: ${remote.description ?? remote.name} [${item.name}]`,
      passthrough: true,
      call: (input) => client.callTool({ name: remote.name, arguments: input }),
    };
  });
}

export async function packageTools(installed: InstalledPackage[], context: PackageToolContext): Promise<GatewayTool[]> {
  const tools: GatewayTool[] = [];
  for (const item of installed.filter((entry) => entry.authorization.allowed && entry.verified)) {
    tools.push(...executableTools(item, context));
    for (const server of item.manifest.spec.contributes.mcpServers) {
      if (context.agentServers.has(`${item.name}:${server.name}`)) continue;
      tools.push(...(await proxiedTools(item, server, context)));
    }
  }
  return tools;
}
