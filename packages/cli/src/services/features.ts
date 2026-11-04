import { resolve } from "node:path";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import {
  loadPackageSource,
  loadV1Project,
  normalizeManifest,
  packageFeatureRules,
  parseFeatureFlags,
  readStoreRecord,
  suggestFeature,
} from "@modai/core";
import semver from "semver";
import { type FeatureChoices, parseSpec } from "./packages.js";
import { lookupRegistry } from "./registries.js";

export type PackageFlags = { spec: string; flags: string[] };

export function splitPackageFlags(tokens: string[]): PackageFlags[] {
  const groups: PackageFlags[] = [];
  for (const token of tokens) {
    if (token.startsWith("-")) {
      if (!groups.length)
        throw new Error(`${token} va después del paquete al que se aplica: modai add @scope/paquete ${token}`);
      groups.at(-1)!.flags.push(token);
    } else groups.push({ spec: token, flags: [] });
  }
  return groups;
}

export async function manifestForSpec(spec: string, root = process.cwd()): Promise<PackageManifestV1> {
  const parsed = parseSpec(spec, root);
  if (parsed.value.startsWith("file:"))
    return normalizeManifest(loadPackageSource(resolve(root, parsed.value.slice(5))).manifest);
  const range = parsed.value;
  const versions = (await lookupRegistry(root).versions(parsed.name))
    .filter(
      (item) =>
        item.status !== "yanked" &&
        semver.valid(item.version) &&
        (range === "*" || semver.satisfies(item.version, range)),
    )
    .sort((a, b) => semver.rcompare(a.version, b.version));
  if (!versions.length)
    throw new Error(`No hay versión de ${parsed.name}${range === "*" ? "" : `@${range}`} en los registries`);
  return normalizeManifest(versions[0]!.manifest);
}

export function featureChoice(manifest: PackageManifestV1, flags: string[]): Record<string, boolean> {
  const names = packageFeatureRules(manifest).map((rule) => rule.name);
  const { choice, unknown } = parseFeatureFlags(flags, names);
  if (unknown.length) {
    const hint = suggestFeature(unknown[0]!, names);
    throw new Error(
      `${manifest.metadata.name} no tiene la opción ${unknown[0]}.${hint ? ` ¿Quisiste decir --${hint}?` : ""}${names.length ? ` Features: ${names.map((name) => `--${name}`).join(", ")}.` : " Este paquete no declara features."} Ver: modai add ${manifest.metadata.name} --help`,
    );
  }
  return choice;
}

export async function featureChoices(groups: PackageFlags[], root: string): Promise<FeatureChoices> {
  const features: FeatureChoices = {};
  for (const item of groups) {
    if (!item.flags.length) continue;
    const manifest = await manifestForSpec(item.spec, root);
    features[manifest.metadata.name] = featureChoice(manifest, item.flags);
  }
  return features;
}

export function installedManifest(root: string, name: string): { manifest: PackageManifestV1; active: string[] } {
  const project = loadV1Project(root);
  const locked = project.lock.packages[name];
  if (!locked) throw new Error(`${name} no está instalado en este proyecto. Instálalo con: modai add ${name}`);
  const record = readStoreRecord(project.root, name);
  if (!record) throw new Error(`Falta ${name} en .modai/store; ejecuta modai sync`);
  return { manifest: normalizeManifest(record.manifest), active: locked.features };
}

export function assertKnownFeatures(manifest: PackageManifestV1, names: string[]): void {
  const declared = packageFeatureRules(manifest).map((rule) => rule.name);
  for (const value of names)
    if (!declared.includes(value)) {
      const hint = suggestFeature(value, declared);
      throw new Error(
        `${manifest.metadata.name} no tiene la feature "${value}".${hint ? ` ¿Quisiste decir "${hint}"?` : ""} Disponibles: ${declared.join(", ") || "ninguna"}.`,
      );
    }
}
