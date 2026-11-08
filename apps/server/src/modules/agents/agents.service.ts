import { invariant } from "@modai/contracts/errors";
import { agentDefinitionSchema, parseInput } from "@modai/contracts/schemas";
import { sha256 } from "@modai/contracts/security";
import type { AgentBundle, EffectiveProfile, ExecutionPolicy } from "@modai/contracts/types";
import {
  agentDefinitionOf,
  contributesSkills,
  effectiveManifest,
  normalizeManifest,
  resolveAgentCapabilities,
  selectPackageFeatures,
  skillFiles,
} from "@modai/core";
import type { PackageReader } from "../auth/authorization.service.js";
import type { PackagesService } from "../packages/packages.service.js";

const INSTRUCTION_FILE = /(^|\/)(SKILL|AGENTS|CLAUDE)\.md$/i;

type Resolved = Awaited<ReturnType<PackagesService["resolve"]>>;

function hasInstructions(contributes: ReturnType<typeof normalizeManifest>["spec"]["contributes"]): boolean {
  return (
    contributes.skills.length > 0 ||
    contributes.rules.length > 0 ||
    contributes.files.some((rule) => INSTRUCTION_FILE.test(rule.target))
  );
}

async function collectInstructions(
  packages: PackagesService,
  resolved: Resolved,
): Promise<AgentBundle["instructions"]> {
  const instructions: AgentBundle["instructions"] = [];
  for (const item of resolved) {
    const { contributes } = normalizeManifest(item.manifest).spec;
    if (!hasInstructions(contributes)) continue;
    const artifact = await packages.getArtifact(item.artifactId);
    const content = (path: string) =>
      Buffer.from(artifact.files.find((file) => file.path === path)!.content, "base64").toString("utf8");
    const add = (path: string) => instructions.push({ packageName: item.name, path, content: content(path) });
    const paths = artifact.files.map((file) => file.path);
    for (const skill of contributes.skills) {
      const entry = skillFiles(skill, paths).find((file) => file.relative === "SKILL.md");
      if (entry) add(entry.source);
    }
    for (const rule of contributes.rules) add(rule.path);
    for (const rule of contributes.files) if (INSTRUCTION_FILE.test(rule.target)) add(rule.source);
  }
  return instructions;
}

export class AgentsService {
  constructor(private readonly packages: PackagesService) {}

  async compose(
    projectId: string,
    name: string,
    range = "*",
    overrides?: Record<string, string>,
    visible?: PackageReader,
    context?: { profile: EffectiveProfile; policy?: ExecutionPolicy },
  ): Promise<AgentBundle> {
    const profile = context?.profile;
    const required =
      profile?.bindings
        .filter((binding) => binding.required)
        .map(({ packageName, range }) => ({
          name: packageName,
          range,
        })) ?? [];
    const selection = await this.packages.resolveSelection(
      { packages: [{ name, range }, ...required], overrides },
      {
        visible,
        pinned: profile?.packages,
      },
    );
    const resolved = selection.packages.map((item) => {
      const manifest = normalizeManifest(item.manifest);
      return {
        ...item,
        manifest: effectiveManifest(manifest, selectPackageFeatures(manifest)) as unknown as typeof item.manifest,
      };
    });
    const root = resolved.find((item) => item.name === name)!;
    const rawDefinition = agentDefinitionOf(root.manifest);
    invariant(rawDefinition, 400, "NOT_AN_AGENT", `${name} no es un agente`);
    const definition = parseInput(agentDefinitionSchema, rawDefinition);
    for (const skill of definition.skills)
      invariant(
        resolved.some((item) => item.name === skill && contributesSkills(item.manifest)),
        400,
        "INVALID_SKILL",
        `${skill} no resuelve a una skill`,
      );
    const capabilities = resolveAgentCapabilities(definition, resolved);
    const policy = context?.policy;
    invariant(
      !policy?.allowedCapabilities || capabilities.every((item) => policy.allowedCapabilities!.includes(item.name)),
      403,
      "EXECUTION_POLICY",
      "La política del proyecto restringe las herramientas de este agente",
    );
    const instructions = await collectInstructions(this.packages, resolved);
    invariant(
      Buffer.byteLength(JSON.stringify(instructions)) <= 500_000,
      413,
      "CONTEXT_TOO_LARGE",
      "Las instrucciones superan el presupuesto de contexto",
    );
    const payload = {
      schemaVersion: 1 as const,
      manifestFormat: "published" as const,
      projectId,
      ...(profile?.organizationId ? { organizationId: profile.organizationId } : {}),
      ...(profile ? { effectiveProfile: profile } : {}),
      ...(policy ? { executionPolicy: policy } : {}),
      agent: { name: root.name, version: root.version, definition },
      packages: selection.packages,
      capabilities,
      instructions,
      permissions: [...new Set(resolved.flatMap((item) => normalizeManifest(item.manifest).spec.permissions))],
    };
    return { ...payload, digest: sha256(JSON.stringify(payload)) };
  }
}
