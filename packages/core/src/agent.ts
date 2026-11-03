import { AppError } from "@modai/contracts/errors";
import { BUILTIN_TOOLS, isBuiltinTool } from "@modai/contracts/agent-tools";
import type { AgentCapability, PackageManifest } from "@modai/contracts/types";
import { normalizeManifest } from "./normalize.js";

type AgentCapabilityPolicy = { capabilities: string[]; memory: { write: boolean } };

/**
 * Resolves the tools an agent selected: MODAI built-ins plus MCP servers contributed by the packages
 * it resolved with. The server composes bundles with this function and the client re-runs it to
 * verify them, so both sides always agree on what an agent can call.
 */
export function resolveAgentCapabilities(definition: AgentCapabilityPolicy, packages: Array<{ name: string; manifest: PackageManifest }>): AgentCapability[] {
  const servers = new Map<string, Extract<AgentCapability, { kind: "mcp" }>>();
  for (const item of packages) {
    for (const server of normalizeManifest(item.manifest).spec.contributes.mcpServers) {
      if (isBuiltinTool(server.name)) throw new AppError(409, "CAPABILITY_COLLISION", `${item.name} define un servidor MCP con nombre reservado: ${server.name}`);
      if (servers.has(server.name)) throw new AppError(409, "CAPABILITY_COLLISION", `Servidor MCP duplicado: ${server.name} (${servers.get(server.name)!.package} y ${item.name})`);
      servers.set(server.name, { kind: "mcp", name: server.name, package: item.name, description: server.description, command: server.command, args: server.args, envKeys: server.envKeys });
    }
  }
  return definition.capabilities.map((name): AgentCapability => {
    if (isBuiltinTool(name)) {
      if (name === "modai_remember" && !definition.memory.write) throw new AppError(400, "MEMORY_POLICY", "El agente solicita escritura de memoria pero su política no lo permite");
      return { kind: "builtin", name, description: BUILTIN_TOOLS[name].description, inputSchema: BUILTIN_TOOLS[name].inputSchema };
    }
    const server = servers.get(name);
    if (!server) throw new AppError(400, "CAPABILITY_NOT_FOUND", `Capacidad no resuelta: ${name} (no es una herramienta de MODAI ni un servidor MCP de sus dependencias)`);
    return server;
  });
}
