import { AppError } from "@modai/contracts/errors";
import { API_VERSION, type PackageManifestV1, packageManifestV1Schema } from "@modai/contracts/manifest";
import type { PackageManifest } from "@modai/contracts/types";

export function normalizeManifest(raw: unknown): PackageManifestV1 {
  const apiVersion = typeof raw === "object" && raw !== null ? (raw as { apiVersion?: unknown }).apiVersion : undefined;
  if (apiVersion !== API_VERSION)
    throw new AppError(
      400,
      "INVALID_MANIFEST",
      `Manifiesto no admitido: usa apiVersion: ${API_VERSION} (docs/spec/PACKAGE-SPEC-v1.md)`,
    );
  const parsed = packageManifestV1Schema.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      400,
      "INVALID_MANIFEST",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  return parsed.data;
}

export function manifestIdentity(raw: PackageManifest): { name: string; version: string } {
  return { name: raw.metadata.name, version: raw.metadata.version };
}

export function agentDefinitionOf(raw: PackageManifest) {
  const agent = normalizeManifest(raw).spec.contributes.agents[0];
  if (!agent) return undefined;
  const { name: _name, ...definition } = agent;
  return definition;
}

export function isAgentPackage(raw: PackageManifest): boolean {
  return normalizeManifest(raw).spec.contributes.agents.length > 0;
}

export function contributesSkills(raw: PackageManifest): boolean {
  return normalizeManifest(raw).spec.contributes.skills.length > 0;
}
