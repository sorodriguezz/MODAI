import { AppError, invariant } from "@modai/contracts/errors";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import semver from "semver";
import { featureDependencies, selectPackageFeatures } from "../packages/package-features.js";
import { resolveCapabilities } from "./capabilities.js";
import { DependencySearch, type Selected } from "./dependency-search.js";
import type { Resolution, ResolvedNode, ResolveInput, ResolveSource } from "./resolution-types.js";
import { CORE_VERSION } from "./version.js";

export { resolveCapabilities } from "./capabilities.js";
export * from "./resolution-types.js";

function orderPackages<T>(
  selected: Selected<T>,
  roots: ResolveInput["roots"],
  featuresOf: (name: string, manifest: PackageManifestV1) => string[],
): Array<ResolvedNode<T>> {
  const ordered: Array<ResolvedNode<T>> = [];
  const added = new Set<string>();
  const append = (name: string): void => {
    if (added.has(name)) return;
    const item = selected.get(name)!;
    const features = featuresOf(name, item.manifest);
    const dependencies = Object.keys(featureDependencies(item.manifest, features));
    for (const dependency of dependencies) append(dependency);
    added.add(name);
    ordered.push({
      name,
      version: item.version,
      manifest: item.manifest,
      ref: item.ref,
      features,
      dependencies: Object.fromEntries(
        dependencies.map((dependency) => [dependency, selected.get(dependency)!.version]),
      ),
    });
  };
  for (const item of roots) append(item.name);
  return ordered;
}

function featureWarnings<T>(search: DependencySearch<T>, selected: Selected<T>, input: ResolveInput): string[] {
  const warnings: string[] = [];
  for (const [name, skip] of search.featureSkips) {
    const chosen = selected.get(name);
    if (chosen && semver.gt(skip.version, chosen.version))
      warnings.push(
        `Se usa ${name}@${chosen.version}: la ${skip.version} no admite las features elegidas (${(skip.error as Error).message.replace(/^[^:]+: /, "")}). Revisa modai.yaml o cámbialas con modai feature.`,
      );
  }
  for (const name of Object.keys(input.features ?? {}))
    if (!selected.has(name)) warnings.push(`modai.yaml elige features de ${name}, que no está instalado; se ignoran`);
  return warnings;
}

function checkCompatibility<T>(packages: Array<ResolvedNode<T>>, input: ResolveInput): void {
  const platform = input.platform ?? process.platform;
  const core = input.coreVersion ?? CORE_VERSION;
  for (const item of packages) {
    const { os, modai } = item.manifest.spec.compatibility;
    if (os && !os.includes(platform as "linux"))
      throw new AppError(
        422,
        "INCOMPATIBLE_PLATFORM",
        `${item.name}@${item.version} no admite ${platform} (admite ${os.join(", ")})`,
      );
    if (modai && !semver.satisfies(core, modai, { includePrerelease: true }))
      throw new AppError(
        422,
        "INCOMPATIBLE_CORE",
        `${item.name}@${item.version} requiere MODAI ${modai}; este Core es ${core}`,
      );
  }
}

export async function resolve<T>(source: ResolveSource<T>, input: ResolveInput): Promise<Resolution<T>> {
  invariant(
    Array.isArray(input.roots) && input.roots.length > 0,
    400,
    "INVALID_RESOLVE_REQUEST",
    "packages es obligatorio",
  );
  const featuresOf = (name: string, manifest: PackageManifestV1) =>
    selectPackageFeatures(manifest, input.features?.[name]);
  const search = new DependencySearch(source, input, featuresOf);
  const selected = await search.solve(
    input.roots.map((item) => ({ name: item.name, range: item.range ?? "*", chain: [] })),
    new Map(),
    new Map(),
  );
  const ordered = orderPackages(selected, input.roots, featuresOf);
  const resolution: Resolution<T> = {
    packages: ordered,
    capabilities: {},
    requires: {},
    missingOptional: [],
    warnings: featureWarnings(search, selected, input),
  };
  checkCompatibility(ordered, input);
  if (input.checkCapabilities !== false) resolveCapabilities(resolution, input.providers ?? {});
  return resolution;
}
