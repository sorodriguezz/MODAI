import type { AgentBundle, CapabilityDefinition, Permission } from "@modai/contracts/types";
import { agentDefinitionSchema, capabilitySchema, parseInput } from "@modai/contracts/schemas";
import { invariant } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import { PackageService } from "./package-service.js";

export class AgentService {
  constructor(private readonly packages: PackageService) {}

  compose(projectId: string, name: string, range = "*", overrides?: Record<string, string>): AgentBundle {
    const resolved = this.packages.resolve({ packages: [{ name, range }], overrides });
    const root = resolved.find(item => item.name === name)!;
    invariant(root.type === "agent" && root.manifest.agent, 400, "NOT_AN_AGENT", `${name} no es un agente`);
    const definition = parseInput(agentDefinitionSchema, root.manifest.agent);
    for (const skill of definition.skills) invariant(resolved.some(item => item.name === skill && item.type === "skill"), 400, "INVALID_SKILL", `${skill} no resuelve a una skill`);
    const available = new Map<string, CapabilityDefinition>();
    for (const item of resolved) for (const raw of item.manifest.capabilities ?? []) {
      const capability = parseInput(capabilitySchema, raw);
      invariant(!available.has(capability.name), 409, "CAPABILITY_COLLISION", `Capacidad duplicada: ${capability.name}`);
      available.set(capability.name, capability);
    }
    const capabilities = definition.capabilities.map(name => {
      const capability = available.get(name);
      invariant(capability, 400, "CAPABILITY_NOT_FOUND", `Capacidad no resuelta: ${name}`);
      invariant(!(capability.kind === "tool" && capability.binding === "memory.remember") || definition.memory.write, 400, "MEMORY_POLICY", "El agente solicita escritura de memoria pero su política no lo permite");
      return capability;
    });
    const instructions: AgentBundle["instructions"] = [];
    for (const item of resolved) {
      if (!["skill", "harness", "methodology"].includes(item.type)) continue;
      const artifact = this.packages.getArtifact(item.artifactId);
      for (const rule of item.manifest.files ?? []) {
        if (!/(^|\/)(SKILL|AGENTS|CLAUDE)\.md$/i.test(rule.target)) continue;
        const file = artifact.files.find(file => file.path === rule.source)!;
        instructions.push({ packageName: item.name, path: rule.source, content: Buffer.from(file.content, "base64").toString("utf8") });
      }
    }
    invariant(Buffer.byteLength(JSON.stringify(instructions)) <= 500_000, 413, "CONTEXT_TOO_LARGE", "Las instrucciones superan el presupuesto de contexto");
    const payload = { schemaVersion: 1 as const, projectId, agent: { name: root.name, version: root.version, definition }, packages: resolved, capabilities, instructions,
      permissions: [...new Set(resolved.flatMap(item => item.manifest.permissions ?? []))] as Permission[] };
    return { ...payload, digest: sha256(JSON.stringify(payload)) };
  }
}
