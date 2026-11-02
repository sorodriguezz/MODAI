import semver from "semver";
import { AppError } from "@modai/contracts/errors";
import { manifestSchema } from "@modai/contracts/schemas";
import { isV1Manifest, type AnyPackageManifest, type PackageManifest } from "@modai/contracts/types";
import { API_VERSION, packageManifestV1Schema, type PackageManifestV1 } from "@modai/contracts/spec-v1";

/**
 * Converts any supported manifest into the canonical v1 view used by the Core.
 * The published manifest stays untouched (signatures and integrity are computed over it);
 * normalisation is a pure, deterministic read-time projection.
 */
export function normalizeManifest(raw: unknown): PackageManifestV1 {
  if (isV1Manifest(raw)) {
    const parsed = packageManifestV1Schema.safeParse(raw);
    if (!parsed.success) throw new AppError(400, "INVALID_MANIFEST", parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    return parsed.data;
  }
  const legacy = manifestSchema.safeParse(raw);
  if (!legacy.success) throw new AppError(400, "INVALID_MANIFEST", `Manifiesto no reconocido (usa apiVersion: ${API_VERSION}): ${legacy.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  return fromLegacy(legacy.data as PackageManifest);
}

export function manifestIdentity(raw: AnyPackageManifest): { name: string; version: string } {
  return isV1Manifest(raw) ? { name: raw.metadata.name, version: raw.metadata.version } : { name: raw.name, version: raw.version };
}

const SKILL_TARGET = /^\.agents\/skills\/([a-z0-9][a-z0-9-]{0,63})\/(.+)$/;

function fromLegacy(manifest: PackageManifest): PackageManifestV1 {
  if (!semver.valid(manifest.version)) throw new AppError(400, "INVALID_VERSION", `version debe ser SemVer: ${manifest.version}`);
  const files = manifest.files ?? [];
  // Legacy skills were raw files under .agents/skills/<name>/. When the mapping is a clean
  // directory copy they become skill contributions, so any adapter can materialise them.
  const groups = new Map<string, Array<{ rule: (typeof files)[number]; source: string; relative: string }>>();
  for (const rule of files) {
    const match = rule.target.replaceAll("\\", "/").match(SKILL_TARGET);
    if (match && !rule.executable) groups.set(match[1], [...(groups.get(match[1]) ?? []), { rule, source: rule.source.replaceAll("\\", "/"), relative: match[2] }]);
  }
  const skills: PackageManifestV1["spec"]["contributes"]["skills"] = [];
  const converted = new Set<(typeof files)[number]>();
  for (const [name, entries] of groups) {
    const entry = entries.find(item => item.relative === "SKILL.md");
    if (!entry) continue;
    const prefix = entry.source.slice(0, entry.source.length - "SKILL.md".length);
    if (!entries.every(item => item.source === prefix + item.relative)) continue;
    skills.push({ name, path: prefix.replace(/\/$/, "") || ".", files: entries.map(item => item.relative).sort() });
    for (const item of entries) converted.add(item.rule);
  }
  const mcpServers = (manifest.capabilities ?? []).flatMap(capability => capability.kind === "mcp"
    ? [{ name: capability.name, description: capability.description, command: capability.command, args: capability.args ?? [], envKeys: capability.envKeys ?? [] }]
    : []);
  const shortName = manifest.name.split("/")[1].replace(/[^a-z0-9-]/g, "-").slice(0, 64);
  return packageManifestV1Schema.parse({
    apiVersion: API_VERSION,
    kind: manifest.type === "profile" ? "Profile" : "Package",
    metadata: { name: manifest.name, version: manifest.version, description: manifest.description },
    spec: {
      category: manifest.type,
      dependencies: manifest.dependencies ?? {},
      permissions: manifest.permissions ?? [],
      contributes: {
        skills,
        knowledge: (manifest.knowledge ?? []).map(rule => ({ path: rule.source, title: rule.title, tags: rule.tags ?? [] })),
        mcpServers,
        agents: manifest.agent ? [{ ...manifest.agent, name: shortName }] : [],
        files: files.filter(rule => !converted.has(rule)),
      },
    },
  });
}

/** Legacy runtime capabilities (builtin bindings, operator bindings, MCP) used by server-composed agents. */
export function legacyCapabilities(raw: AnyPackageManifest): NonNullable<PackageManifest["capabilities"]> {
  return isV1Manifest(raw) ? [] : raw.capabilities ?? [];
}

/** Agent definition of a package, legacy (`agent`) or v1 (first `contributes.agents` entry), without the v1 name field. */
export function agentDefinitionOf(raw: AnyPackageManifest): PackageManifest["agent"] | undefined {
  if (!isV1Manifest(raw)) return raw.agent;
  const agent = normalizeManifest(raw).spec.contributes.agents[0];
  if (!agent) return undefined;
  const { name: _name, ...definition } = agent;
  return definition;
}

export function isAgentPackage(raw: AnyPackageManifest): boolean {
  return isV1Manifest(raw) ? normalizeManifest(raw).spec.contributes.agents.length > 0 : raw.type === "agent";
}

/** True when a package contributes Agent Skills (legacy type skill or v1 skills). */
export function contributesSkills(raw: AnyPackageManifest): boolean {
  return isV1Manifest(raw) ? normalizeManifest(raw).spec.contributes.skills.length > 0 : raw.type === "skill";
}
