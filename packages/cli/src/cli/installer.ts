import { existsSync, readFileSync, rmSync } from "node:fs";
import { isV1Manifest, type ArtifactFile, type PackageManifest, type PackageRecord, type SignaturePolicy, type Permission } from "@modai/contracts/types";
import { sha256, requiredTargetPermission, publicKeyFingerprint, signaturePayload, verifyEd25519 } from "@modai/contracts/security";
import { ApiClient } from "@modai/sdk";
import { loadClientConfig, type LockedPackage, type ProjectLock, type ProjectManifest } from "./config.js";
import { localApproval, saveLocalApproval } from "./approvals.js";
import { safeProjectPath, writeProjectFile } from "./safe-path.js";

export function verifyPackage(item: PackageRecord, artifact: { files: ArtifactFile[]; sha256: string }, policy: SignaturePolicy = "optional", trustedPublishers: string[] = []): void {
  if (sha256(JSON.stringify({ files: artifact.files })) !== artifact.sha256) throw new Error(`Integridad del artefacto inválida: ${item.name}`);
  const paths = new Set<string>();
  for (const file of artifact.files) {
    if (paths.has(file.path) || sha256(Buffer.from(file.content, "base64")) !== file.sha256) throw new Error(`Integridad inválida: ${item.name}:${file.path}`);
    paths.add(file.path);
  }
  if (!item.signature) {
    if (policy !== "optional") throw new Error(`Firma requerida para ${item.name}`);
    return;
  }
  const fingerprint = publicKeyFingerprint(item.signature.publicKey);
  if (item.signature.algorithm !== "ed25519" || fingerprint !== item.signerFingerprint || !verifyEd25519(item.signature.publicKey, item.signature.signature, signaturePayload(item.manifest, artifact.files))) throw new Error(`Firma inválida: ${item.name}`);
  if (policy === "trusted" && !trustedPublishers.includes(fingerprint)) throw new Error(`Publicador no autorizado localmente: ${fingerprint}`);
}

export async function installationPolicy(api: ApiClient, manifest: ProjectManifest) {
  const global = loadClientConfig(), health = await api.health();
  const policies: SignaturePolicy[] = ["optional", "signed", "trusted"];
  const rank = Math.max(...[global?.signaturePolicy, manifest.signaturePolicy, health.signaturePolicy].map(value => policies.indexOf(value ?? "optional")));
  return { policy: policies[Math.max(rank, 0)], trustedPublishers: global?.trustedPublishers ?? [] };
}

function currentHash(path: string): string | undefined {
  return existsSync(path) ? sha256(readFileSync(path)) : undefined;
}

export async function synchronize(
  api: ApiClient,
  root: string,
  manifest: ProjectManifest,
  previous: ProjectLock,
  explicitGrants: Permission[] = [],
): Promise<{ lock: ProjectLock; preserved: string[] }> {
  const trust = await installationPolicy(api, manifest);
  const approval = localApproval(root, manifest.projectId, manifest.server);
  const granted = [...new Set([...approval.permissions, ...explicitGrants])];
  const requested = Object.entries(manifest.packages).map(([name, range]) => ({ name, range }));
  const resolved = requested.length ? await api.resolve(requested, manifest.overrides) : [];
  const oldFiles = new Map<string, { packageName: string; sha256: string }>();
  for (const item of previous.packages) {
    for (const file of item.files) oldFiles.set(file.target.replaceAll("\\", "/"), { packageName: item.name, sha256: file.sha256 });
  }

  const desiredTargets = new Map<string, string>();
  const pending: Array<{ package: PackageRecord; target: string; path: string; content: Buffer; sha256: string; executable: boolean }> = [];
  for (const item of resolved) {
    if (isV1Manifest(item.manifest)) throw new Error(`${item.name}@${item.version} usa la especificación v1; este proyecto usa el formato 0.5. Ejecuta 'modai migrate' para convertirlo.`);
    const legacy = item.manifest as PackageManifest;
    const artifact = await api.artifact(item.artifactId);
    verifyPackage(item, artifact, trust.policy, trust.trustedPublishers);
    const sources = new Map(artifact.files.map((file) => [file.path, file]));
    for (const rule of legacy.files ?? []) {
      const source = sources.get(rule.source);
      if (!source) throw new Error(`Artefacto inválido: ${item.name} no contiene ${rule.source}`);
      const content = Buffer.from(source.content, "base64");
      if (sha256(content) !== source.sha256) throw new Error(`Integridad inválida en ${item.name}:${rule.source}`);
      const target = rule.target.replaceAll("\\", "/");
      const permission = requiredTargetPermission(target);
      for (const required of [permission, rule.executable ? "process.execute" : undefined] as Array<Permission | undefined>) {
        if (required && (!legacy.permissions?.includes(required) || !granted.includes(required))) throw new Error(`La instalación requiere conceder ${required}: ${target}`);
      }
      const owner = desiredTargets.get(target.toLowerCase());
      if (owner && owner !== item.name) throw new Error(`Colisión: ${owner} y ${item.name} administran ${target}`);
      desiredTargets.set(target.toLowerCase(), item.name);
      const path = safeProjectPath(root, target);
      const existing = currentHash(path);
      const old = oldFiles.get(target);
      if (existing && existing !== source.sha256 && (!old || existing !== old.sha256)) {
        throw new Error(`Conflicto en ${target}: contiene cambios no administrados. Muévelo o resuelve el cambio antes de continuar.`);
      }
      pending.push({ package: item, target, path, content, sha256: source.sha256, executable: rule.executable ?? false });
    }
  }

  const preserved: string[] = [];
  for (const [target, old] of oldFiles) {
    if (desiredTargets.has(target.toLowerCase())) continue;
    const permission = requiredTargetPermission(target);
    if (permission && !granted.includes(permission)) { preserved.push(`${target} (requiere conceder ${permission})`); continue; }
    const path = safeProjectPath(root, target);
    const existing = currentHash(path);
    if (!existing) continue;
    if (existing === old.sha256) rmSync(path, { force: true });
    else preserved.push(`${target} (modificado; antes pertenecía a ${old.packageName})`);
  }

  for (const file of pending) {
    writeProjectFile(root, file.target, file.content, file.executable);
  }

  const packages: LockedPackage[] = resolved.map((item) => ({
    name: item.name,
    version: item.version,
    artifactId: item.artifactId,
    files: pending
      .filter((file) => file.package.name === item.name)
      .map((file) => ({ target: file.target, sha256: file.sha256 })),
  }));
  saveLocalApproval(root, manifest.projectId, manifest.server, { ...approval, permissions: granted });
  return { lock: { schemaVersion: 1, generatedAt: new Date().toISOString(), packages }, preserved };
}
