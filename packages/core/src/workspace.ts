import { relative, resolve as resolvePath } from "node:path";
import semver from "semver";
import { AppError } from "@modai/contracts/errors";
import type { LockFile, LockedPackageV1, PackageManifestV1, RegistrySource } from "@modai/contracts/spec-v1";
import { availableAdapters, planContributions, selectAdapters, type InstallUnit } from "./adapters.js";
import { buildContextIndex, saveContextIndex } from "./context.js";
import { applyDesiredState, pruneStore, readStoreRecord, storePackageDir, verifyStore, writeStore } from "./installer.js";
import { computeIntegrity, verifyFiles, verifySignature, type TrustPolicy } from "./integrity.js";
import { normalizeManifest } from "./normalize.js";
import { applyPackageFeatures, effectiveManifest } from "./package-features.js";
import { ensureProjectGitignore, loadGrants, saveLock, type V1Project } from "./project.js";
import { CompositeRegistry, HttpRegistry, LocalRegistry, type PackageArtifact, type Registry } from "./registry.js";
import { CapabilityError, resolve, type Candidate } from "./resolver.js";
import { loadPackageSource } from "./source.js";
import { authorize, sameFeatures } from "./tools.js";
import { validatePackage } from "./validate.js";

export function createRegistries(root: string, sources: RegistrySource[], tokenFor: (url: string) => string | undefined): Registry[] {
  return sources.map(source => source.path ? new LocalRegistry(resolvePath(root, source.path)) : new HttpRegistry(source.url!, tokenFor(source.url!)));
}

export interface SyncOptions {
  registries: Registry[];
  /** Install-time permissions granted on this machine (for example project.instructions). */
  grants: string[];
  trust: TrustPolicy;
  /** Ignore the lock for every package (true) or for the listed ones. */
  update?: boolean | string[];
  /** Fail instead of changing modai.lock (CI). */
  frozen?: boolean;
  force?: boolean;
  /** Keep user-modified managed files; the new version is written next to them (.modai-new). */
  keepMine?: boolean;
}

export interface SyncReport {
  lock: LockFile;
  installed: Array<{ name: string; version: string; source: string }>;
  written: string[];
  removed: string[];
  preserved: string[];
  /** Files written as <file>.modai-new because the user kept their own version. */
  sideBySide: string[];
  warnings: string[];
  missingOptional: Array<{ package: string; capability: string; range: string }>;
  /** Packages whose content changed since this machine authorised their executable contributions. */
  regrant: string[];
}

type Ref = { kind: "registry" } | { kind: "file"; path: string; artifact: PackageArtifact };

function lockComparable(lock: LockFile) {
  return JSON.stringify({ packages: Object.fromEntries(Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))), capabilities: Object.fromEntries(Object.entries(lock.capabilities).sort(([a], [b]) => a.localeCompare(b))) });
}

/** Converges a project to modai.yaml (+ modai.lock). The same inputs always produce the same environment. */
export async function syncWorkspace(project: V1Project, options: SyncOptions): Promise<SyncReport> {
  const { root, file } = project;
  const registry = new CompositeRegistry(options.registries);
  const fileDependencies = new Map<string, { path: string; artifact: PackageArtifact; manifest: PackageManifestV1 }>();
  for (const [name, spec] of Object.entries(file.dependencies)) {
    if (!spec.startsWith("file:")) continue;
    const directory = resolvePath(root, spec.slice(5));
    const input = loadPackageSource(directory);
    const manifest = validatePackage(input.manifest, input.files);
    if (manifest.metadata.name !== name) throw new AppError(400, "FILE_DEPENDENCY_MISMATCH", `${spec} contiene ${manifest.metadata.name}, no ${name}`);
    const path = relative(root, directory).replaceAll("\\", "/") || ".";
    fileDependencies.set(name, { path, manifest, artifact: { name, version: manifest.metadata.version, manifest: input.manifest, files: input.files, integrity: computeIntegrity(input.manifest, input.files), source: `file:${path}` } });
  }
  const warnings: string[] = [];
  const source = {
    async versions(name: string): Promise<Array<Candidate<Ref>>> {
      const local = fileDependencies.get(name);
      if (local) return [{ version: local.manifest.metadata.version, status: "active", manifest: local.manifest, ref: { kind: "file", path: local.path, artifact: local.artifact } }];
      const result: Array<Candidate<Ref>> = [];
      for (const item of await registry.versions(name)) {
        try { result.push({ version: item.version, status: item.status, manifest: normalizeManifest(item.manifest), ref: { kind: "registry" } }); }
        catch (error) { warnings.push(`Se ignora ${name}@${item.version}: ${(error as Error).message}`); }
      }
      return result;
    },
  };
  const updating = (name: string) => options.update === true || (Array.isArray(options.update) && options.update.includes(name));
  const locked = Object.fromEntries(Object.entries(project.lock.packages).filter(([name]) => !updating(name)).map(([name, item]) => [name, item.version]));
  const roots = Object.entries(file.dependencies).map(([name, spec]) => ({ name, range: spec.startsWith("file:") ? "*" : spec }));

  let resolution: Awaited<ReturnType<typeof resolve<Ref>>> | undefined;
  const units: InstallUnit[] = [];
  const artifacts = new Map<string, PackageArtifact>();
  const lockedPackages: Record<string, LockedPackageV1> = {};
  if (roots.length) {
    try {
      resolution = await resolve(source, { roots, overrides: file.overrides, providers: file.providers, locked, features: file.features });
    } catch (error) {
      if (error instanceof CapabilityError && error.code === "CAPABILITY_UNSATISFIED") {
        const capability = (error.details as { capability: string }).capability;
        const suggestions = await suggestProviders(registry, capability).catch(() => []);
        throw new CapabilityError(409, error.code, `${error.message}.${suggestions.length ? ` Paquetes que la proporcionan: ${suggestions.map(item => `${item.name}@${item.version}`).join(", ")}. Instala uno con modai add <paquete>.` : " Ningún registry configurado la proporciona."}`, { ...(error.details as object), suggestions });
      }
      throw error;
    }
    for (const node of resolution.packages) {
      const artifact = node.ref.kind === "file" ? node.ref.artifact : await registry.fetch(node.name, node.version);
      verifyFiles(node.name, artifact.files);
      const manifest = validatePackage(artifact.manifest, artifact.files);
      if (manifest.metadata.name !== node.name || manifest.metadata.version !== node.version) throw new AppError(400, "IDENTITY_MISMATCH", `El registry devolvió ${manifest.metadata.name}@${manifest.metadata.version} en lugar de ${node.name}@${node.version}`);
      const integrity = computeIntegrity(artifact.manifest, artifact.files);
      const previous = project.lock.packages[node.name];
      if (previous && previous.version === node.version && previous.integrity !== integrity && node.ref.kind === "registry") {
        throw new AppError(409, "LOCK_INTEGRITY_MISMATCH", `${node.name}@${node.version} no coincide con la integridad de modai.lock (${previous.integrity}). El registry sirvió contenido distinto para la misma versión.`);
      }
      const signer = node.ref.kind === "registry" ? verifySignature(node.name, artifact.manifest, artifact.files, artifact.signature, options.trust) : undefined;
      // The unit carries the package as installed: base plus the contributions, dependencies and overlays of its features.
      const applied = applyPackageFeatures(manifest, new Map(artifact.files.map(item => [item.path, Buffer.from(item.content, "base64")])), node.features);
      units.push({ name: node.name, version: node.version, manifest: applied.manifest, files: applied.files });
      lockedPackages[node.name] = {
        version: node.version, source: artifact.source, integrity, ...(signer ? { signer } : {}),
        kind: manifest.kind, category: manifest.spec.category, dependencies: node.dependencies,
        provides: manifest.spec.provides.map(item => `${item.capability}@${item.version}`),
        requires: resolution.requires[node.name] ?? {},
        permissions: [...manifest.spec.permissions].sort(),
        features: node.features,
      };
      artifacts.set(node.name, { ...artifact, integrity });
    }
  }
  const nextLock: LockFile = { lockfileVersion: 1, packages: lockedPackages, capabilities: resolution?.capabilities ?? {}, managed: project.lock.managed };
  if (options.frozen && lockComparable(nextLock) !== lockComparable(project.lock)) {
    throw new AppError(409, "LOCK_OUTDATED", "modai.lock no corresponde a modai.yaml. Ejecuta modai sync sin --frozen y versiona el lock.");
  }

  // Store first: tools and MCP resources read from it. Then project files.
  ensureProjectGitignore(root);
  for (const artifact of artifacts.values()) writeStore(root, artifact);
  pruneStore(root, new Set(units.map(unit => unit.name)));
  const adapters = selectAdapters(file.adapters, availableAdapters(units));
  const desired = planContributions(units, adapters);
  const applied = applyDesiredState({ root, previous: project.lock.managed, desired, grants: options.grants, force: options.force, keepMine: options.keepMine });
  nextLock.managed = applied.managed;
  saveContextIndex(root, buildContextIndex(units));
  saveLock(root, nextLock);

  const grants = loadGrants(root);
  const regrant = Object.entries(grants.packages).filter(([name, grant]) => lockedPackages[name] && (grant.integrity !== lockedPackages[name].integrity || !sameFeatures(grant.features, lockedPackages[name].features))).map(([name]) => name);
  return {
    lock: nextLock,
    installed: units.map(unit => ({ name: unit.name, version: unit.version, source: lockedPackages[unit.name].source })),
    written: applied.written, removed: applied.removed, preserved: applied.preserved, sideBySide: applied.sideBySide,
    warnings: [...warnings, ...(resolution?.warnings ?? [])],
    missingOptional: resolution?.missingOptional ?? [],
    regrant,
  };
}

export async function suggestProviders(registry: Registry, capability: string): Promise<Array<{ name: string; version: string; provides: string }>> {
  const result: Array<{ name: string; version: string; provides: string }> = [];
  for (const item of await registry.list()) {
    try {
      const provided = normalizeManifest(item.manifest).spec.provides.find(entry => entry.capability === capability);
      if (provided) result.push({ name: item.name, version: item.version, provides: `${provided.capability}@${provided.version}` });
    } catch { /* skip invalid */ }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name) || semver.rcompare(a.version, b.version));
}

export interface InstalledPackage {
  name: string; version: string; kind: string; category: string; description: string; integrity: string; verified: boolean;
  manifest: PackageManifestV1; packageDir: string; files: string[];
  authorization: ReturnType<typeof authorize>;
}

/** Reads what is installed from the lock and the store, verifying each package's integrity. */
export function inspectWorkspace(project: V1Project): InstalledPackage[] {
  const grants = loadGrants(project.root);
  return Object.entries(project.lock.packages).map(([name, locked]) => {
    const record = readStoreRecord(project.root, name);
    const verified = verifyStore(project.root, name, locked.integrity);
    // What is installed is the package with the features recorded in the lock.
    const manifest = record ? effectiveManifest(normalizeManifest(record.manifest), locked.features) : undefined;
    if (!manifest) throw new AppError(409, "STORE_MISSING", `Falta ${name} en .modai/store; ejecuta modai sync`);
    return {
      name, version: locked.version, kind: locked.kind, category: locked.category, description: manifest.metadata.description,
      integrity: locked.integrity, verified, manifest, packageDir: storePackageDir(project.root, name), files: record!.files.map(file => file.path),
      authorization: authorize(locked, grants.packages[name]),
    };
  });
}
