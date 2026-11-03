import { isBuiltinTool } from "@modai/contracts/agent-tools";
import { invariant } from "@modai/contracts/errors";
import type { PackageManifestV1 } from "@modai/contracts/manifest";

export function validateAgents(manifest: PackageManifestV1): void {
  const { spec } = manifest;
  const { contributes } = spec;
  const hasDependencies = Object.keys(spec.dependencies).length > 0;
  for (const agent of contributes.agents) {
    for (const skill of agent.skills)
      invariant(
        Boolean(spec.dependencies[skill]),
        400,
        "AGENT_DEPENDENCY",
        `La skill ${skill} debe declararse como dependencia`,
      );
    invariant(
      !agent.capabilities.includes("modai_remember") || agent.memory.write,
      400,
      "MEMORY_POLICY",
      `El agente ${agent.name} usa modai_remember pero memory.write es false`,
    );
    for (const capability of agent.capabilities) {
      invariant(
        isBuiltinTool(capability) ||
          contributes.mcpServers.some((server) => server.name === capability) ||
          hasDependencies,
        400,
        "AGENT_CAPABILITY",
        `La capacidad ${capability} no es una herramienta de MODAI ni un servidor MCP: decláralo en contributes.mcpServers o depende del paquete que lo aporta`,
      );
    }
  }
}
