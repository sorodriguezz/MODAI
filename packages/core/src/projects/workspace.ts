import { AppError } from "@modai/contracts/errors";
import type { LockFile } from "@modai/contracts/manifest";
import { buildContextIndex, saveContextIndex } from "../agents/context.js";
import { sameFeatures } from "../agents/tool-authorization.js";
import { availableAdapters, selectAdapters } from "../installation/adapters.js";
import { applyDesiredState } from "../installation/apply.js";
import { planContributions } from "../installation/plan-contributions.js";
import { pruneStore, writeStore } from "../installation/store.js";
import type { TrustPolicy } from "../packages/integrity.js";
import { CompositeRegistry } from "../registries/composite-registry.js";
import type { Registry } from "../registries/registry.js";
import type { Resolution } from "../resolution/resolver.js";
import { loadFileDependencies, type WorkspaceRef, workspaceSource } from "./file-dependencies.js";
import { collectInstallSet, type InstallSet } from "./install-units.js";
import { ensureProjectGitignore, saveLock, type V1Project } from "./project.js";
import { loadGrants } from "./project-grants.js";
import { resolveWorkspace } from "./resolve-workspace.js";

export interface SyncOptions {
  registries: Registry[];
  grants: string[];
  trust: TrustPolicy;
  update?: boolean | string[];
  frozen?: boolean;
  force?: boolean;
  keepMine?: boolean;
}

export interface SyncReport {
  lock: LockFile;
  installed: Array<{ name: string; version: string; source: string }>;
  written: string[];
  removed: string[];
  preserved: string[];
  sideBySide: string[];
  warnings: string[];
  missingOptional: Array<{ package: string; capability: string; range: string }>;
  regrant: string[];
}

function lockComparable(lock: LockFile) {
  return JSON.stringify({
    packages: Object.fromEntries(Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))),
    capabilities: Object.fromEntries(Object.entries(lock.capabilities).sort(([a], [b]) => a.localeCompare(b))),
  });
}

function lockedVersions(project: V1Project, update: SyncOptions["update"]): Record<string, string> {
  const updating = (name: string) => update === true || (Array.isArray(update) && update.includes(name));
  return Object.fromEntries(
    Object.entries(project.lock.packages)
      .filter(([name]) => !updating(name))
      .map(([name, item]) => [name, item.version]),
  );
}

async function resolveProject(project: V1Project, options: SyncOptions, registry: CompositeRegistry) {
  const { root, file } = project;
  const warnings: string[] = [];
  const source = workspaceSource(registry, loadFileDependencies(root, file), warnings);
  const roots = Object.entries(file.dependencies).map(([name, spec]) => ({
    name,
    range: spec.startsWith("file:") ? "*" : spec,
  }));
  const locked = lockedVersions(project, options.update);
  const resolution: Resolution<WorkspaceRef> | undefined = roots.length
    ? await resolveWorkspace(source, registry, file, roots, locked)
    : undefined;
  return { resolution, warnings };
}

function packagesToRegrant(root: string, set: InstallSet): string[] {
  const grants = loadGrants(root);
  return Object.entries(grants.packages)
    .filter(([name, grant]) => {
      const locked = set.lockedPackages[name];
      return locked && (grant.integrity !== locked.integrity || !sameFeatures(grant.features, locked.features));
    })
    .map(([name]) => name);
}

export async function syncWorkspace(project: V1Project, options: SyncOptions): Promise<SyncReport> {
  const { root, file } = project;
  const registry = new CompositeRegistry(options.registries);
  const { resolution, warnings } = await resolveProject(project, options, registry);
  const set = await collectInstallSet(resolution, { registry, lock: project.lock, trust: options.trust });
  const nextLock: LockFile = {
    lockfileVersion: 1,
    packages: set.lockedPackages,
    capabilities: resolution?.capabilities ?? {},
    managed: project.lock.managed,
  };
  if (options.frozen && lockComparable(nextLock) !== lockComparable(project.lock))
    throw new AppError(
      409,
      "LOCK_OUTDATED",
      "modai.lock no corresponde a modai.yaml. Ejecuta modai sync sin --frozen y versiona el lock.",
    );
  ensureProjectGitignore(root);
  for (const artifact of set.artifacts.values()) writeStore(root, artifact);
  pruneStore(root, new Set(set.units.map((unit) => unit.name)));
  const adapters = selectAdapters(file.adapters, availableAdapters(set.units));
  const applied = applyDesiredState({
    root,
    previous: project.lock.managed,
    desired: planContributions(set.units, adapters),
    grants: options.grants,
    force: options.force,
    keepMine: options.keepMine,
  });
  nextLock.managed = applied.managed;
  saveContextIndex(root, buildContextIndex(set.units));
  saveLock(root, nextLock);
  return {
    lock: nextLock,
    installed: set.units.map((unit) => ({
      name: unit.name,
      version: unit.version,
      source: set.lockedPackages[unit.name].source,
    })),
    written: applied.written,
    removed: applied.removed,
    preserved: applied.preserved,
    sideBySide: applied.sideBySide,
    warnings: [...warnings, ...(resolution?.warnings ?? [])],
    missingOptional: resolution?.missingOptional ?? [],
    regrant: packagesToRegrant(root, set),
  };
}
