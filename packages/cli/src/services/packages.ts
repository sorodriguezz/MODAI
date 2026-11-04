import { relative, resolve } from "node:path";
import {
  INSTALL_PERMISSIONS,
  loadGrants,
  loadPackageSource,
  loadV1Project,
  normalizeManifest,
  type SyncReport,
  saveGrants,
  saveProjectFile,
} from "@modai/core";
import { runSync } from "./sync.js";

export type FeatureChoices = Record<string, Record<string, boolean>>;

const LOCAL_SPEC = /^(file:|\.\/|\.\.\/|\/|[A-Za-z]:[\\/])/;

export function parseSpec(spec: string, root: string): { name: string; value: string } {
  if (LOCAL_SPEC.test(spec)) {
    const directory = resolve(root, spec.replace(/^file:/, ""));
    const input = loadPackageSource(directory);
    const name = normalizeManifest(input.manifest).metadata.name;
    return { name, value: `file:${relative(root, directory).replaceAll("\\", "/") || "."}` };
  }
  const separator = spec.lastIndexOf("@");
  if (!spec.startsWith("@") || !spec.includes("/"))
    throw new Error(`Paquete inválido: ${spec}. Usa @scope/nombre[@rango] o una ruta file:`);
  if (separator > spec.indexOf("/")) return { name: spec.slice(0, separator), value: spec.slice(separator + 1) || "*" };
  return { name: spec, value: "*" };
}

export interface AddOptions {
  allow?: string[];
  force?: boolean;
  keepMine?: boolean;
  features?: FeatureChoices;
}

export async function addPackages(
  root: string,
  specs: string[],
  options: AddOptions,
): Promise<{ names: string[]; report: SyncReport; needsGrant: string[] }> {
  const parsed = specs.map((spec) => parseSpec(spec, root));
  const { report, project } = await runSync(
    root,
    (file) => {
      for (const item of parsed) {
        file.dependencies[item.name] = item.value;
        const choice = options.features?.[item.name];
        if (choice && Object.keys(choice).length)
          file.features[item.name] = { ...(file.features[item.name] ?? {}), ...choice };
      }
    },
    { allow: options.allow, force: options.force, keepMine: options.keepMine, update: parsed.map((item) => item.name) },
  );
  const pinned = parsed.filter((item) => item.value === "*" && project.lock.packages[item.name]);
  if (pinned.length) {
    const file = loadV1Project(root).file;
    for (const item of pinned) file.dependencies[item.name] = `^${project.lock.packages[item.name].version}`;
    saveProjectFile(root, file);
  }
  const needsGrant = parsed
    .filter((item) =>
      project.lock.packages[item.name]?.permissions.some((permission) => !INSTALL_PERMISSIONS.includes(permission)),
    )
    .map((item) => item.name);
  return { names: parsed.map((item) => item.name), report, needsGrant };
}

export function featuresText(names: string[], report: SyncReport, separator: string): string {
  return names
    .filter((name) => report.lock.packages[name]?.features.length)
    .map((name) => `${name} (${report.lock.packages[name]!.features.join(", ")})`)
    .join(separator);
}

export async function removePackage(root: string, name: string): Promise<SyncReport> {
  const project = loadV1Project(root);
  if (!(name in project.file.dependencies)) throw new Error(`${name} no es una dependencia directa del proyecto.`);
  const { report } = await runSync(root, (file) => {
    delete file.dependencies[name];
    delete file.features[name];
    for (const [capability, provider] of Object.entries(file.providers))
      if (provider === name) delete file.providers[capability];
  });
  const grants = loadGrants(root);
  for (const grantName of Object.keys(grants.packages))
    if (!report.lock.packages[grantName]) delete grants.packages[grantName];
  saveGrants(root, grants);
  return report;
}

export function changedVersions(
  before: Record<string, { version: string }>,
  report: SyncReport,
): Array<{ package: string; from: string; to: string }> {
  return Object.entries(report.lock.packages)
    .filter(([name, item]) => before[name]?.version !== item.version)
    .map(([name, item]) => ({ package: name, from: before[name]?.version ?? "nuevo", to: item.version }));
}
