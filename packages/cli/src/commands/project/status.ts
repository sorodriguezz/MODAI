import { API_VERSION } from "@modai/contracts/manifest";
import { type InstalledPackage, inspectWorkspace, loadV1Project, type V1Project } from "@modai/core";
import type { Command } from "commander";
import { requireProject } from "../../services/project.js";
import type { Print } from "../../terminal/output.js";

function executable(item: InstalledPackage): string {
  if (!item.authorization.missing.length && !item.authorization.allowed) return "no";
  return item.authorization.allowed ? "autorizado" : "requiere modai permissions grant";
}

function installedRow(project: V1Project, item: InstalledPackage) {
  const features = project.lock.packages[item.name]?.features;
  return {
    name: item.name,
    version: item.version,
    kind: item.kind,
    category: item.category,
    verified: item.verified,
    ...(features?.length ? { features } : {}),
    provides: item.manifest.spec.provides.map((capability) => `${capability.capability}@${capability.version}`),
    contributes: Object.fromEntries(
      Object.entries(item.manifest.spec.contributes)
        .filter(([, value]) => value.length)
        .map(([key, value]) => [key, value.length]),
    ),
    executable: executable(item),
  };
}

export function projectStatus(root: string) {
  const project = loadV1Project(root);
  const { file } = project;
  return {
    project: file.name,
    format: API_VERSION,
    ...(file.context.projectId ? { projectId: file.context.projectId, server: file.context.server } : {}),
    registries: file.registries.map((item) => item.url ?? item.path),
    adapters: file.adapters,
    memory: file.context.memory,
    dependencies: file.dependencies,
    ...(Object.keys(file.features).length ? { features: file.features } : {}),
    installed: inspectWorkspace(project).map((item) => installedRow(project, item)),
    capabilities: project.lock.capabilities,
  };
}

export function registerStatus(program: Command, print: Print): void {
  program
    .command("status")
    .description("Muestra el estado del proyecto")
    .action(() => print(projectStatus(requireProject())));
}
