import { existsSync } from "node:fs";
import { join } from "node:path";
import type { V1Project } from "@modai/core";
import { loadActivation } from "../agents/activation.js";
import { agentInstructions, verifyBundle } from "../agents/bundle.js";
import { CapabilityHost } from "../agents/capabilities.js";
import { runtimeOptions } from "../agents/runtime-options.js";
import { serverClient, serverProject } from "../services/server-project.js";
import { installationPolicy } from "../services/trust.js";
import type { GatewayTool } from "./context-tools.js";

const GENERIC_TOOLS = ["modai_remember", "modai_recall", "modai_search_knowledge"];

export interface ActiveAgent {
  host?: CapabilityHost;
  instructions?: string;
  servers: Set<string>;
}

export async function startActiveAgent(project: V1Project, tools: GatewayTool[]): Promise<ActiveAgent> {
  const servers = new Set<string>();
  if (!existsSync(join(project.root, ".modai", "activation.json"))) return { servers };
  const activation = loadActivation(project.root);
  const target = serverProject(project.root),
    api = serverClient(target);
  await verifyBundle(api, activation.bundle, await installationPolicy(api, target));
  const instructions = agentInstructions(activation.bundle);
  for (const capability of activation.bundle.capabilities)
    if (capability.kind === "mcp") servers.add(`${capability.package}:${capability.name}`);
  const host = new CapabilityHost(api, activation.bundle, { ...runtimeOptions({}, activation), cwd: project.root });
  await host.start();
  // why: an active agent exposes only its selected capabilities, so generic memory/search cannot bypass its policy
  for (let index = tools.length - 1; index >= 0; index--)
    if (GENERIC_TOOLS.includes(tools[index].name)) tools.splice(index, 1);
  return { host, instructions, servers };
}

export function hostTools(host: CapabilityHost | undefined, reserved: Set<string>): GatewayTool[] {
  return (host?.list() ?? []).map((tool) => {
    if (reserved.has(tool.name)) throw new Error(`Colisión con herramienta reservada: ${tool.name}`);
    reserved.add(tool.name);
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      readOnly: false,
      call: (input) => host!.call(tool.name, input),
    };
  });
}
