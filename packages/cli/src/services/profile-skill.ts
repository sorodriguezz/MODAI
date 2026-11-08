import type { ArtifactFile, PackageRecord, SignaturePolicy } from "@modai/contracts/types";
import { effectiveManifest, normalizeManifest, selectPackageFeatures, skillFiles } from "@modai/core";
import type { profileConnection } from "./profile.js";
import { installationPolicy, verifyPackage } from "./trust.js";

type ProfileConnection = ReturnType<typeof profileConnection>;

function selectSkill(item: PackageRecord, files: ArtifactFile[], name?: string) {
  const manifest = normalizeManifest(item.manifest);
  const skills = effectiveManifest(manifest, selectPackageFeatures(manifest)).spec.contributes.skills;
  const identity = { packageName: item.name, version: item.version };
  if (!name) return { ...identity, skills: skills.map((skill) => skill.name) };
  const skill = skills.find((entry) => entry.name === name);
  if (!skill) throw new Error("Skill no encontrada en el paquete");
  const path = skillFiles(
    skill,
    files.map((file) => file.path),
  ).find((file) => file.relative === "SKILL.md")?.source;
  const file = files.find((entry) => entry.path === path);
  if (!file) throw new Error("La skill no tiene un archivo SKILL.md");
  const content = Buffer.from(file.content, "base64");
  if (content.length > 100_000) throw new Error("La skill excede el presupuesto de contexto");
  return { ...identity, skill: name, path, content: content.toString("utf8") };
}

export function profileSkillReader({ api, id, platform }: ProfileConnection, signaturePolicy?: SignaturePolicy) {
  let cached: { id: string; artifact: Awaited<ReturnType<typeof api.artifact>> } | undefined;
  return async (packageName: string, name?: string) => {
    const profile = await api.effectiveProfile(id, platform);
    const pin = profile.packages.find((item) => item.name === packageName);
    if (!pin) throw new Error("El paquete no está en el perfil efectivo");
    const item = await api.getPackage(pin.name, pin.version);
    if (item.artifactId !== pin.artifactId || item.status === "yanked")
      throw new Error("El paquete cambió durante la consulta del perfil");
    const artifact = cached?.id === pin.artifactId ? cached.artifact : await api.artifact(pin.artifactId);
    const trust = await installationPolicy(api, { signaturePolicy });
    verifyPackage(item, artifact, trust.policy, trust.trustedPublishers);
    if (artifact.files.reduce((sum, file) => sum + file.content.length, 0) <= 2_000_000)
      cached = { id: pin.artifactId, artifact };
    return selectSkill(item, artifact.files, name);
  };
}
