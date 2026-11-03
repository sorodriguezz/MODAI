import { assertSafeRelativePath } from "@modai/contracts/security";
import semver from "semver";
import YAML from "yaml";
import { assertFeatureRules, type FeatureRule, featureNameProblem } from "./features.js";

/**
 * Modular templates. A template is a base project plus optional *features* layered on top when the person asks for
 * them (`modai template use @eq/springboot ./api --sdd --x-lib`). The author declares them in `modai.template.yaml`
 * at the root of the template; that file is never copied into the new project:
 *
 *   features:
 *     sdd:
 *       description: Spec-Driven Development
 *       path: features/sdd           # folder whose files are overlaid on the project root
 *       requires: [docs]             # switched on together with this one
 *       conflicts: [legacy]          # cannot be combined
 *       default: true                # on unless --no-sdd
 *       vars: { specsDir: specs }    # default values for {{markers}} while this feature is on
 *       uses: "@eq/sdd-addon@1.0.0"  # external add-on template layered before the folder
 *       packages:                    # MODAI packages added to the new project's modai.yaml
 *         "@methodologies/sdd": "^1"
 *         "@components/health": { version: "^1", features: [metrics] }
 *   addon:                           # present when this template is a layer for others
 *     for: ["@eq/springboot"]        # bases it is made for (omit for any)
 *
 * Everything outside the manifest and the feature folders is the base. Layers apply in order (base, then each
 * selected feature in declaration order, then `--with` add-ons); a later layer replaces a file of an earlier one.
 */
export const TEMPLATE_MANIFEST = "modai.template.yaml";

export interface TemplatePackage {
  version: string;
  features: string[];
}
export interface TemplateFeature extends FeatureRule {
  path?: string;
  uses?: string;
  vars: Record<string, string>;
  packages: Record<string, TemplatePackage>;
}
export interface TemplateManifest {
  features: TemplateFeature[];
  addon?: { for: string[] };
}
export interface TemplateFile {
  path: string;
  content: string;
}

const TEMPLATE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const TEMPLATE_SPEC = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(@[^\s@]+)?$/;
const FEATURE_KEYS = ["description", "path", "uses", "default", "requires", "conflicts", "vars", "packages"];

const problem = (message: string): never => {
  throw new Error(`${TEMPLATE_MANIFEST}: ${message}`);
};
const names = (value: unknown, label: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    problem(`${label} debe ser una lista de nombres`);
  return value as string[];
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseTemplateManifest(text: string): TemplateManifest {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    return problem(`no es YAML válido: ${(error as Error).message}`);
  }
  if (raw === null || raw === undefined) return { features: [] };
  if (!isObject(raw)) return problem('debe ser un objeto con "features" y/o "addon"');
  for (const key of Object.keys(raw))
    if (!["features", "addon"].includes(key)) problem(`clave desconocida "${key}" (usa "features" o "addon")`);
  if (raw.features !== undefined && !isObject(raw.features)) problem('"features" es un mapa nombre → definición');
  const features: TemplateFeature[] = [];
  for (const [name, value] of Object.entries((raw.features ?? {}) as Record<string, unknown>)) {
    const nameProblem = featureNameProblem(name);
    if (nameProblem) problem(nameProblem);
    const item = value ?? {};
    if (!isObject(item)) return problem(`la feature "${name}" debe ser un objeto`);
    for (const key of Object.keys(item))
      if (!FEATURE_KEYS.includes(key))
        problem(`la feature "${name}" no admite "${key}" (admite ${FEATURE_KEYS.join(", ")})`);
    if (typeof item.description !== "string" || !item.description.trim())
      problem(`la feature "${name}" necesita una description (es lo que se ve en --help)`);
    if (item.path !== undefined && (typeof item.path !== "string" || !item.path.trim()))
      problem(`path de "${name}" debe ser una carpeta`);
    if (item.uses !== undefined && (typeof item.uses !== "string" || !TEMPLATE_SPEC.test(item.uses)))
      problem(`uses de "${name}" debe ser @namespace/nombre[@versión]`);
    if (item.default !== undefined && typeof item.default !== "boolean")
      problem(`default de "${name}" debe ser true o false`);
    if (item.vars !== undefined && !isObject(item.vars)) problem(`vars de "${name}" es un mapa clave: valor`);
    const vars: Record<string, string> = {};
    for (const [key, val] of Object.entries((item.vars ?? {}) as Record<string, unknown>)) {
      if (!/^[A-Za-z][\w-]*$/.test(key) || !["string", "number", "boolean"].includes(typeof val))
        problem(`vars de "${name}" admite marcadores simples (clave: texto)`);
      vars[key] = String(val);
    }
    if (item.packages !== undefined && !isObject(item.packages))
      problem(`packages de "${name}" es un mapa @scope/paquete → versión`);
    const packages: Record<string, TemplatePackage> = {};
    for (const [pkg, spec] of Object.entries((item.packages ?? {}) as Record<string, unknown>)) {
      if (!TEMPLATE_NAME.test(pkg)) problem(`packages de "${name}": "${pkg}" no es @scope/nombre`);
      if (typeof spec === "string") packages[pkg] = { version: spec, features: [] };
      else if (isObject(spec) && (spec.version === undefined || typeof spec.version === "string")) {
        for (const key of Object.keys(spec))
          if (!["version", "features"].includes(key))
            problem(`packages de "${name}": ${pkg} admite version y features`);
        packages[pkg] = {
          version: (spec.version as string | undefined) ?? "*",
          features: names(spec.features, `packages.${pkg}.features de "${name}"`),
        };
      } else problem(`packages de "${name}": ${pkg} debe ser un rango ("^1") o { version, features }`);
      // Only registry ranges: a template must not point a new project at local folders (file:) or invalid versions.
      if (!semver.validRange(packages[pkg]!.version))
        problem(
          `packages de "${name}": la versión de ${pkg} debe ser un rango SemVer ("^1.2", "1.x"), no "${packages[pkg]!.version}"`,
        );
      for (const feature of packages[pkg]!.features)
        if (featureNameProblem(feature)) problem(`packages de "${name}": ${featureNameProblem(feature)}`);
    }
    features.push({
      name,
      description: item.description!.toString().trim(),
      default: item.default === true,
      requires: names(item.requires, `requires de "${name}"`),
      conflicts: names(item.conflicts, `conflicts de "${name}"`),
      ...(item.path ? { path: String(item.path).replace(/\/+$/, "") } : {}),
      ...(item.uses ? { uses: item.uses as string } : {}),
      vars,
      packages,
    });
  }
  let addon: TemplateManifest["addon"];
  if (raw.addon !== undefined) {
    if (!isObject(raw.addon)) return problem('"addon" es un objeto');
    addon = { for: names(raw.addon.for, "addon.for") };
    for (const base of addon.for)
      if (!TEMPLATE_NAME.test(base)) problem(`addon.for contiene "${base}", que no es @namespace/nombre`);
  }
  return { features, ...(addon ? { addon } : {}) };
}

/** Throws when the manifest points at folders the template does not have, or its features contradict each other. */
export function validateTemplateManifest(manifest: TemplateManifest, paths: string[]): void {
  try {
    assertFeatureRules(manifest.features, TEMPLATE_MANIFEST);
  } catch (error) {
    throw new Error((error as Error).message);
  }
  const folders = manifest.features.filter((feature) => feature.path).map((feature) => feature.path!);
  for (const feature of manifest.features) {
    if (
      !feature.path &&
      !feature.uses &&
      !Object.keys(feature.vars).length &&
      !feature.requires.length &&
      !Object.keys(feature.packages).length
    )
      problem(`la feature "${feature.name}" no hace nada: añade path, uses, vars, packages o requires`);
    if (!feature.path) continue;
    assertSafeRelativePath(feature.path, `path de ${feature.name}`);
    if (!paths.some((path) => path.startsWith(`${feature.path}/`)))
      problem(`la carpeta "${feature.path}" de "${feature.name}" no existe o está vacía en el template`);
    for (const other of folders)
      if (other !== feature.path && (other.startsWith(`${feature.path}/`) || feature.path.startsWith(`${other}/`)))
        problem(`las carpetas "${feature.path}" y "${other}" se anidan; cada feature necesita la suya`);
  }
}

const underFeature = (manifest: TemplateManifest, path: string) =>
  manifest.features.some((feature) => feature.path && path.startsWith(`${feature.path}/`));

/** The base project: everything but the manifest and the feature folders. */
export function baseFiles(files: TemplateFile[], manifest: TemplateManifest): TemplateFile[] {
  return files.filter((file) => file.path !== TEMPLATE_MANIFEST && !underFeature(manifest, file.path));
}

/** External add-ons the chosen features ask for (`uses`), in order and without repeats. */
export function requiredAddons(manifest: TemplateManifest, selected: string[]): string[] {
  return [
    ...new Set(
      selected
        .map((name) => manifest.features.find((feature) => feature.name === name)?.uses)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export interface ComposedTemplate {
  files: TemplateFile[];
  variables: Record<string, string>;
  packages: Record<string, TemplatePackage>;
  overwritten: string[];
}

/**
 * Layers the base, each selected feature (its `uses` add-on first, then its folder) and the extra `--with` add-ons.
 * `addons` maps an add-on spec (as written in `uses`/`--with`) to its already-filtered base files.
 */
export function composeTemplate(input: {
  files: TemplateFile[];
  manifest: TemplateManifest;
  selected: string[];
  addons?: Map<string, TemplateFile[]>;
  extraAddons?: string[];
}): ComposedTemplate {
  const result = new Map<string, TemplateFile>();
  const overwritten = new Set<string>();
  const put = (file: TemplateFile) => {
    if (result.has(file.path)) overwritten.add(file.path);
    result.set(file.path, file);
  };
  for (const file of baseFiles(input.files, input.manifest)) result.set(file.path, file);
  const variables: Record<string, string> = {};
  const packages: Record<string, TemplatePackage> = {};
  const layer = (spec: string, reason: string) => {
    const files = input.addons?.get(spec);
    if (!files) throw new Error(`Falta el add-on ${spec}${reason}`);
    for (const file of files) put(file);
  };
  for (const name of input.selected) {
    const feature = input.manifest.features.find((item) => item.name === name)!;
    if (feature.uses) layer(feature.uses, ` que necesita "${name}"`);
    if (feature.path)
      for (const file of input.files)
        if (file.path.startsWith(`${feature.path}/`)) put({ ...file, path: file.path.slice(feature.path.length + 1) });
    Object.assign(variables, feature.vars);
    for (const [pkg, spec] of Object.entries(feature.packages)) {
      const previous = packages[pkg];
      packages[pkg] = {
        version: previous && previous.version !== "*" ? previous.version : spec.version,
        features: [...new Set([...(previous?.features ?? []), ...spec.features])],
      };
    }
  }
  for (const spec of input.extraAddons ?? []) layer(spec, "");
  return { files: [...result.values()], variables, packages, overwritten: [...overwritten].sort() };
}
