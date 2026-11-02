import type { AgentBundle, CapabilityDefinition, Permission } from "@modai/contracts/types";
import { agentDefinitionSchema, capabilitySchema, parseInput } from "@modai/contracts/schemas";
import { invariant } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import { agentDefinitionOf, contributesSkills, legacyCapabilities, normalizeManifest, skillFiles } from "@modai/core";
import { PackageService } from "./package-service.js";

const INSTRUCTION_FILE = /(^|\/)(SKILL|AGENTS|CLAUDE)\.md$/i;

export class AgentService {
  constructor(private readonly packages: PackageService) {}

  async compose(projectId: string, name: string, range = "*", overrides?: Record<string, string>): Promise<AgentBundle> {
    const resolved = await this.packages.resolve({ packages: [{ name, range }], overrides });
    const root = resolved.find(item => item.name === name)!;
    const rawDefinition = agentDefinitionOf(root.manifest);
    invariant(rawDefinition, 400, "NOT_AN_AGENT", `${name} no es un agente`);
    const definition = parseInput(agentDefinitionSchema, rawDefinition);
    for (const skill of definition.skills) invariant(resolved.some(item => item.name === skill && contributesSkills(item.manifest)), 400, "INVALID_SKILL", `${skill} no resuelve a una skill`);
    const available = new Map<string, CapabilityDefinition>();
    for (const item of resolved) for (const raw of legacyCapabilities(item.manifest)) {
      const capability = parseInput(capabilitySchema, raw);
      invariant(!available.has(capability.name), 409, "CAPABILITY_COLLISION", `Capacidad duplicada: ${capability.name}`);
      available.set(capability.name, capability);
    }
    const capabilities = definition.capabilities.map(capabilityName => {
      const capability = available.get(capabilityName);
      invariant(capability, 400, "CAPABILITY_NOT_FOUND", `Capacidad no resuelta: ${capabilityName}`);
      invariant(!(capability.kind === "tool" && capability.binding === "memory.remember") || definition.memory.write, 400, "MEMORY_POLICY", "El agente solicita escritura de memoria pero su política no lo permite");
      return capability;
    });
    // Instructions come from contributions (skills, rules and instruction files), never from a package category.
    const instructions: AgentBundle["instructions"] = [];
    for (const item of resolved) {
      const manifest = normalizeManifest(item.manifest);
      const { contributes } = manifest.spec;
      if (!contributes.skills.length && !contributes.rules.length && !contributes.files.some(rule => INSTRUCTION_FILE.test(rule.target))) continue;
      const artifact = this.packages.getArtifact(item.artifactId);
      const content = (path: string) => Buffer.from(artifact.files.find(file => file.path === path)!.content, "base64").toString("utf8");
      const paths = artifact.files.map(file => file.path);
      for (const skill of contributes.skills) {
        const entry = skillFiles(skill, paths).find(file => file.relative === "SKILL.md");
        if (entry) instructions.push({ packageName: item.name, path: entry.source, content: content(entry.source) });
      }
      for (const rule of contributes.rules) instructions.push({ packageName: item.name, path: rule.path, content: content(rule.path) });
      for (const rule of contributes.files) if (INSTRUCTION_FILE.test(rule.target)) instructions.push({ packageName: item.name, path: rule.source, content: content(rule.source) });
    }
    invariant(Buffer.byteLength(JSON.stringify(instructions)) <= 500_000, 413, "CONTEXT_TOO_LARGE", "Las instrucciones superan el presupuesto de contexto");
    const payload = { schemaVersion: 1 as const, projectId, agent: { name: root.name, version: root.version, definition }, packages: resolved, capabilities, instructions,
      permissions: [...new Set(resolved.flatMap(item => normalizeManifest(item.manifest).spec.permissions))] as Permission[] };
    return { ...payload, digest: sha256(JSON.stringify(payload)) };
  }
}
