import type { ProjectFile } from "@modai/contracts/manifest";
import {
  createRegistries,
  loadGrants,
  loadV1Project,
  type Registry,
  type SyncReport,
  saveGrants,
  saveProjectFile,
  syncWorkspace,
  type V1Project,
} from "@modai/core";
import { ApiClient } from "@modai/sdk";
import { tokenFor } from "./connection.js";
import { requireProject } from "./project.js";
import { trustPolicy } from "./trust.js";

export interface RunSyncOptions {
  allow?: string[];
  update?: boolean | string[];
  frozen?: boolean;
  force?: boolean;
  keepMine?: boolean;
  registries?: Registry[];
}

export async function runSync(
  root: string,
  change?: (file: ProjectFile) => void,
  options: RunSyncOptions = {},
): Promise<{ report: SyncReport; project: V1Project }> {
  const project = loadV1Project(requireProject(root));
  const file = structuredClone(project.file);
  change?.(file);
  const grants = loadGrants(project.root);
  const install = [...new Set([...grants.install, ...(options.allow ?? [])])];
  const next = { ...project, file };
  const report = await syncWorkspace(next, {
    registries: options.registries ?? createRegistries(project.root, file.registries, tokenFor),
    grants: install,
    trust: trustPolicy(file),
    update: options.update,
    frozen: options.frozen,
    force: options.force,
    keepMine: options.keepMine,
  });
  if (change) saveProjectFile(project.root, file);
  if (options.allow?.length) saveGrants(project.root, { ...loadGrants(project.root), install });
  if (!options.frozen) await reportInstallations(file, report);
  return { report, project: { ...next, lock: report.lock } };
}

async function reportInstallations(file: ProjectFile, report: SyncReport): Promise<void> {
  const { projectId, server } = file.context;
  if (!projectId || !server || process.env.MODAI_NO_USAGE_REPORT) return;
  const packages = Object.entries(report.lock.packages).map(([name, item]) => ({
    name,
    version: item.version,
    direct: name in file.dependencies,
  }));
  try {
    await new ApiClient(server, tokenFor(server)).reportInstallations(projectId, packages, AbortSignal.timeout(3000));
  } catch {
    return;
  }
}
