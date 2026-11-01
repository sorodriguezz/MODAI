import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { PackageRecord } from "../core/types.js";
import { sha256 } from "../core/security.js";
import { ApiClient } from "./api.js";
import type { LockedPackage, ProjectLock, ProjectManifest } from "./config.js";

function targetPath(root: string, target: string): string {
  const path = resolve(root, target);
  const relation = relative(root, path);
  if (relation.startsWith("..") || isAbsolute(relation)) throw new Error(`Ruta de instalación fuera del proyecto: ${target}`);
  return path;
}

function currentHash(path: string): string | undefined {
  return existsSync(path) ? sha256(readFileSync(path)) : undefined;
}

export async function synchronize(
  api: ApiClient,
  root: string,
  manifest: ProjectManifest,
  previous: ProjectLock,
): Promise<{ lock: ProjectLock; preserved: string[] }> {
  const requested = Object.entries(manifest.packages).map(([name, range]) => ({ name, range }));
  const resolved = requested.length ? await api.resolve(requested, manifest.overrides) : [];
  const oldFiles = new Map<string, { packageName: string; sha256: string }>();
  for (const item of previous.packages) {
    for (const file of item.files) oldFiles.set(file.target.replaceAll("\\", "/"), { packageName: item.name, sha256: file.sha256 });
  }

  const desiredTargets = new Map<string, string>();
  const pending: Array<{ package: PackageRecord; target: string; path: string; content: Buffer; sha256: string; executable: boolean }> = [];
  for (const item of resolved) {
    const artifact = await api.artifact(item.artifactId);
    const sources = new Map(artifact.files.map((file) => [file.path, file]));
    for (const rule of item.manifest.files ?? []) {
      const source = sources.get(rule.source);
      if (!source) throw new Error(`Artefacto inválido: ${item.name} no contiene ${rule.source}`);
      const content = Buffer.from(source.content, "base64");
      if (sha256(content) !== source.sha256) throw new Error(`Integridad inválida en ${item.name}:${rule.source}`);
      const target = rule.target.replaceAll("\\", "/");
      const owner = desiredTargets.get(target);
      if (owner && owner !== item.name) throw new Error(`Colisión: ${owner} y ${item.name} administran ${target}`);
      desiredTargets.set(target, item.name);
      const path = targetPath(root, target);
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
    if (desiredTargets.has(target)) continue;
    const path = targetPath(root, target);
    const existing = currentHash(path);
    if (!existing) continue;
    if (existing === old.sha256) rmSync(path, { force: true });
    else preserved.push(`${target} (modificado; antes pertenecía a ${old.packageName})`);
  }

  for (const file of pending) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content);
    if (file.executable && process.platform !== "win32") chmodSync(file.path, 0o755);
  }

  const packages: LockedPackage[] = resolved.map((item) => ({
    name: item.name,
    version: item.version,
    artifactId: item.artifactId,
    files: pending
      .filter((file) => file.package.name === item.name)
      .map((file) => ({ target: file.target, sha256: file.sha256 })),
  }));
  return { lock: { schemaVersion: 1, generatedAt: new Date().toISOString(), packages }, preserved };
}
