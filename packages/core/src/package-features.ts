import { AppError } from "@modai/contracts/errors";
import type { Contributions, PackageManifestV1 } from "@modai/contracts/spec-v1";
import { selectFeatures, type FeatureRule } from "./features.js";

/** The features of a package as plain rules, in declaration order. */
export function packageFeatureRules(manifest: PackageManifestV1): FeatureRule[] {
  return Object.entries(manifest.spec.features).map(([name, feature]) => ({ name, description: feature.description, default: feature.default, requires: feature.requires, conflicts: feature.conflicts }));
}

/** Features that apply to `manifest` for a modai.yaml choice (defaults, requested ones and what they require). */
export function selectPackageFeatures(manifest: PackageManifestV1, choice: Record<string, boolean> = {}): string[] {
  return selectFeatures(packageFeatureRules(manifest), choice, `${manifest.metadata.name}@${manifest.metadata.version}`);
}

/** Dependencies of the package with the selected features on: its own plus the features' ones. */
export function featureDependencies(manifest: PackageManifestV1, selected: string[]): Record<string, string> {
  const dependencies = { ...manifest.spec.dependencies };
  // Two features may need the same package: both constraints apply (a space joins SemVer ranges as "and").
  for (const name of selected) for (const [dependency, range] of Object.entries(manifest.spec.features[name]!.dependencies)) {
    dependencies[dependency] = dependencies[dependency] && dependencies[dependency] !== range ? `${dependencies[dependency]} ${range}` : range;
  }
  return dependencies;
}

const CONTRIBUTION_KEYS = ["skills", "rules", "knowledge", "tools", "mcpServers", "components", "files"] as const;

/**
 * The manifest the Core installs: the package with the contributions and dependencies of its selected features merged
 * in. Everything downstream (adapters, index, context, tools) works on this view, so a feature can add any kind of
 * contribution without special cases. `features` stays as declared.
 */
export function effectiveManifest(manifest: PackageManifestV1, selected: string[]): PackageManifestV1 {
  if (!selected.length) return manifest;
  const contributes = structuredClone(manifest.spec.contributes) as Contributions;
  for (const name of selected) {
    const feature = manifest.spec.features[name];
    if (!feature) throw new AppError(422, "FEATURE_SELECTION", `${manifest.metadata.name} no tiene la feature "${name}"`);
    for (const key of CONTRIBUTION_KEYS) (contributes[key] as unknown[]).push(...structuredClone(feature.contributes[key]));
  }
  return { ...manifest, spec: { ...manifest.spec, dependencies: featureDependencies(manifest, selected), contributes } };
}

/**
 * Package files as the installer sees them: each overlay of a selected feature adds its files to the component it
 * names, replacing files with the same relative path. Later features win over earlier ones.
 */
export function effectiveFiles(manifest: PackageManifestV1, files: Map<string, Buffer>, selected: string[]): Map<string, Buffer> {
  const overlays = selected.flatMap(name => manifest.spec.features[name]!.overlays.map(overlay => ({ ...overlay, feature: name })));
  if (!overlays.length) return files;
  const components = effectiveManifest(manifest, selected).spec.contributes.components;
  const result = new Map(files);
  for (const overlay of overlays) {
    const component = components.find(item => item.name === overlay.component);
    if (!component) throw new AppError(422, "FEATURE_SELECTION", `La feature "${overlay.feature}" de ${manifest.metadata.name} modifica el componente "${overlay.component}", que no está activo`);
    const from = `${overlay.path.replace(/\/$/, "")}/`;
    const into = component.path === "." ? "" : `${component.path.replace(/\/$/, "")}/`;
    for (const [path, content] of files) if (path.startsWith(from)) result.set(`${into}${path.slice(from.length)}`, content);
  }
  return result;
}

/** Manifest and files with the selected features applied. */
export function applyPackageFeatures(manifest: PackageManifestV1, files: Map<string, Buffer>, selected: string[]): { manifest: PackageManifestV1; files: Map<string, Buffer> } {
  return { manifest: effectiveManifest(manifest, selected), files: effectiveFiles(manifest, files, selected) };
}
