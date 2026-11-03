import { invariant } from "@modai/contracts/errors";
import { assertSafeRelativePath } from "@modai/contracts/security";
import semver from "semver";
import { componentTargetPermission, expandTemplate } from "../installation/targets.js";
import {
  contributionDirectories,
  featureOwnDirectories,
  featureOwnPaths,
  isInside,
  type PackageFeatureSpec,
} from "./feature-paths.js";
import { assertFeatureRules } from "./feature-rules.js";
import { packageFeatureRules } from "./package-features.js";
import type { FeatureContributions, PackageValidation } from "./package-validation.js";

type CheckContributions = (contributes: FeatureContributions, where: string) => void;

interface FeatureContext {
  validation: PackageValidation;
  baseDirectories: string[];
  entries: Array<[string, PackageFeatureSpec]>;
}

function validateFeatureDependencies(context: FeatureContext, name: string, feature: PackageFeatureSpec): void {
  const { manifest } = context.validation;
  for (const [dependency, range] of Object.entries(feature.dependencies)) {
    invariant(
      Boolean(semver.validRange(range)),
      400,
      "INVALID_DEPENDENCY",
      `Dependencia inválida en la feature ${name}: ${dependency}@${range}`,
    );
    invariant(
      dependency !== manifest.metadata.name,
      400,
      "INVALID_DEPENDENCY",
      `La feature ${name} no puede depender del propio paquete`,
    );
    invariant(
      !(dependency in manifest.spec.dependencies),
      400,
      "INVALID_DEPENDENCY",
      `${dependency} ya es dependencia del paquete; quítala de la feature ${name}`,
    );
  }
  invariant(
    Object.values(feature.contributes).some((list) => list.length) ||
      Object.keys(feature.dependencies).length > 0 ||
      feature.overlays.length > 0 ||
      feature.requires.length > 0,
    400,
    "INVALID_FEATURE",
    `La feature ${name} no aporta nada: añade contributes, dependencies, overlays o requires`,
  );
}

function validateFeatureOutsideBase(context: FeatureContext, name: string, feature: PackageFeatureSpec): void {
  for (const directory of contributionDirectories(feature.contributes))
    invariant(
      directory !== "",
      400,
      "FEATURE_PATH_IN_BASE",
      `La feature ${name} usa la raíz del paquete como carpeta: instalaría todos los archivos. Usa una carpeta propia (por ejemplo features/${name}).`,
    );
  for (const path of featureOwnPaths(feature)) {
    const base = context.baseDirectories.find((directory) => isInside(path, directory));
    invariant(
      base === undefined,
      400,
      "FEATURE_PATH_IN_BASE",
      `La feature ${name} usa ${path}, que está dentro de ${base || "la raíz"}, una carpeta del paquete base: el base la instalaría siempre. Mueve los archivos de la feature a su propia carpeta (por ejemplo features/${name}).`,
    );
  }
}

function validateFeatureDirectory(context: FeatureContext, name: string, directory: string): void {
  for (const base of context.baseDirectories)
    invariant(
      !isInside(base, directory),
      400,
      "FEATURE_PATH_IN_BASE",
      `La carpeta ${base || "raíz"} del paquete base está dentro de ${directory}, de la feature ${name}`,
    );
  for (const [otherName, other] of context.entries) {
    if (otherName === name) continue;
    const clash = featureOwnPaths(other).find((path) => isInside(path, directory));
    invariant(
      clash === undefined,
      400,
      "FEATURE_PATH_OVERLAP",
      `La feature ${otherName} usa ${clash}, dentro de ${directory}, una carpeta de la feature ${name}: se instalaría con ella. Dale a cada feature su propia carpeta.`,
    );
  }
}

function reachableFeatures(features: Record<string, PackageFeatureSpec>, name: string, seen = new Set<string>()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const result: string[] = [name];
  for (const required of features[name]!.requires) result.push(...reachableFeatures(features, required, seen));
  return result;
}

function validateFeatureOverlays(context: FeatureContext, name: string, feature: PackageFeatureSpec): void {
  const { manifest, paths } = context.validation;
  const { spec } = manifest;
  const components = reachableFeatures(spec.features, name)
    .flatMap((required) => spec.features[required]!.contributes.components)
    .concat(spec.contributes.components);
  for (const overlay of feature.overlays) {
    assertSafeRelativePath(overlay.path, "overlays.path");
    invariant(
      components.some((component) => component.name === overlay.component),
      400,
      "INVALID_FEATURE",
      `La feature ${name} modifica el componente "${overlay.component}", que no existe en el paquete ni en las features que requiere`,
    );
    const from = `${overlay.path.replace(/\/$/, "")}/`;
    invariant(
      [...paths].some((path) => path.startsWith(from)),
      400,
      "MISSING_SOURCE",
      `La feature ${name}: la carpeta ${overlay.path} no tiene archivos`,
    );
    const component = components.find((item) => item.name === overlay.component)!;
    const directory = expandTemplate(component.target, {
      component: component.name,
      package: manifest.metadata.name,
    }).replace(/\/$/, "");
    for (const path of paths)
      if (path.startsWith(from)) componentTargetPermission(`${directory}/${path.slice(from.length)}`);
  }
}

export function validateFeatures(validation: PackageValidation, checkContributions: CheckContributions): void {
  const { manifest } = validation;
  const entries = Object.entries(manifest.spec.features);
  if (!entries.length) return;
  assertFeatureRules(packageFeatureRules(manifest), manifest.metadata.name);
  const context: FeatureContext = {
    validation,
    baseDirectories: contributionDirectories(manifest.spec.contributes),
    entries,
  };
  for (const [name, feature] of entries) {
    validateFeatureDependencies(context, name, feature);
    checkContributions(feature.contributes, name);
    validateFeatureOutsideBase(context, name, feature);
    for (const directory of featureOwnDirectories(feature)) validateFeatureDirectory(context, name, directory);
    validateFeatureOverlays(context, name, feature);
  }
}
