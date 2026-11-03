import semver from "semver";
import { featureNameProblem } from "../packages/feature-rules.js";
import {
  isPlainObject,
  stringList,
  TEMPLATE_NAME,
  type TemplateFeature,
  type TemplatePackage,
  templateProblem,
} from "./template-types.js";

const TEMPLATE_SPEC = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(@[^\s@]+)?$/;
const FEATURE_KEYS = ["description", "path", "uses", "default", "requires", "conflicts", "vars", "packages"];

const isBlankText = (value: unknown) => typeof value !== "string" || !value.trim();

function assertFeatureShape(name: string, item: Record<string, unknown>): void {
  for (const key of Object.keys(item))
    if (!FEATURE_KEYS.includes(key))
      templateProblem(`la feature "${name}" no admite "${key}" (admite ${FEATURE_KEYS.join(", ")})`);
  if (isBlankText(item.description))
    templateProblem(`la feature "${name}" necesita una description (es lo que se ve en --help)`);
  if (item.path !== undefined && isBlankText(item.path)) templateProblem(`path de "${name}" debe ser una carpeta`);
  if (item.uses !== undefined && (typeof item.uses !== "string" || !TEMPLATE_SPEC.test(item.uses)))
    templateProblem(`uses de "${name}" debe ser @namespace/nombre[@versión]`);
  if (item.default !== undefined && typeof item.default !== "boolean")
    templateProblem(`default de "${name}" debe ser true o false`);
}

function parseVars(name: string, value: unknown): Record<string, string> {
  if (value !== undefined && !isPlainObject(value)) templateProblem(`vars de "${name}" es un mapa clave: valor`);
  const vars: Record<string, string> = {};
  for (const [key, val] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    if (!/^[A-Za-z][\w-]*$/.test(key) || !["string", "number", "boolean"].includes(typeof val))
      templateProblem(`vars de "${name}" admite marcadores simples (clave: texto)`);
    vars[key] = String(val);
  }
  return vars;
}

function parsePackageSpec(name: string, pkg: string, spec: unknown): TemplatePackage {
  if (typeof spec === "string") return { version: spec, features: [] };
  if (isPlainObject(spec) && (spec.version === undefined || typeof spec.version === "string")) {
    for (const key of Object.keys(spec))
      if (!["version", "features"].includes(key))
        templateProblem(`packages de "${name}": ${pkg} admite version y features`);
    return {
      version: (spec.version as string | undefined) ?? "*",
      features: stringList(spec.features, `packages.${pkg}.features de "${name}"`),
    };
  }
  return templateProblem(`packages de "${name}": ${pkg} debe ser un rango ("^1") o { version, features }`);
}

function parsePackages(name: string, value: unknown): Record<string, TemplatePackage> {
  if (value !== undefined && !isPlainObject(value))
    templateProblem(`packages de "${name}" es un mapa @scope/paquete → versión`);
  const packages: Record<string, TemplatePackage> = {};
  for (const [pkg, spec] of Object.entries((value ?? {}) as Record<string, unknown>)) {
    if (!TEMPLATE_NAME.test(pkg)) templateProblem(`packages de "${name}": "${pkg}" no es @scope/nombre`);
    const parsed = parsePackageSpec(name, pkg, spec);
    packages[pkg] = parsed;
    if (!semver.validRange(parsed.version))
      templateProblem(
        `packages de "${name}": la versión de ${pkg} debe ser un rango SemVer ("^1.2", "1.x"), no "${parsed.version}"`,
      );
    for (const feature of parsed.features) {
      const problem = featureNameProblem(feature);
      if (problem) templateProblem(`packages de "${name}": ${problem}`);
    }
  }
  return packages;
}

export function parseTemplateFeature(name: string, item: unknown): TemplateFeature {
  if (!isPlainObject(item)) return templateProblem(`la feature "${name}" debe ser un objeto`);
  assertFeatureShape(name, item);
  const vars = parseVars(name, item.vars);
  const packages = parsePackages(name, item.packages);
  return {
    name,
    description: String(item.description).trim(),
    default: item.default === true,
    requires: stringList(item.requires, `requires de "${name}"`),
    conflicts: stringList(item.conflicts, `conflicts de "${name}"`),
    ...(item.path ? { path: String(item.path).replace(/\/+$/, "") } : {}),
    ...(item.uses ? { uses: item.uses as string } : {}),
    vars,
    packages,
  };
}
