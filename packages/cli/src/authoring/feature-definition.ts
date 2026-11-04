import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { normalizeManifest, parseTemplateManifest, TEMPLATE_MANIFEST, validateTemplateManifest } from "@modai/core";
import YAML from "yaml";
import { parseSpec } from "../services/packages.js";

export interface FeatureDefinition {
  description?: string;
  path?: string;
  component?: string;
  default?: boolean;
  requires?: string[];
  conflicts?: string[];
  package?: string[];
  var?: string[];
  uses?: string;
}

function filesUnder(root: string, relative = ""): string[] {
  return readdirSync(join(root, relative)).flatMap((entry) => {
    const path = relative ? posix.join(relative, entry) : entry;
    if (!statSync(join(root, path)).isDirectory()) return [path];
    return /(^|\/)(node_modules|\.git)$/.test(path) ? [] : filesUnder(root, path);
  });
}

function featureFile(root: string): { isPackage: boolean; file: string } {
  const isPackage = existsSync(join(root, "modai.package.yaml"));
  return { isPackage, file: join(root, isPackage ? "modai.package.yaml" : TEMPLATE_MANIFEST) };
}

function openDocument(file: string): YAML.Document {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  return YAML.parseDocument(
    text.trim() && YAML.parse(text) ? text : `${text}${text && !text.endsWith("\n") ? "\n" : ""}{}\n`,
  );
}

function common(options: FeatureDefinition): Record<string, unknown> {
  return {
    ...(options.default ? { default: true } : {}),
    ...(options.requires?.length ? { requires: options.requires } : {}),
    ...(options.conflicts?.length ? { conflicts: options.conflicts } : {}),
  };
}

function definePackageFeature(
  document: YAML.Document,
  name: string,
  options: FeatureDefinition,
  packages: Record<string, string>,
): void {
  const components = (document.getIn(["spec", "contributes", "components"]) as YAML.YAMLSeq | undefined)?.toJSON() as
    | Array<{ name: string }>
    | undefined;
  const component = options.component ?? components?.[0]?.name;
  if (options.path && !component)
    throw new Error(
      "--path añade archivos a un componente y este paquete no declara ninguno (spec.contributes.components)",
    );
  document.setIn(["spec", "features", name], {
    description: options.description!,
    ...common(options),
    ...(Object.keys(packages).length ? { dependencies: packages } : {}),
    ...(options.path ? { overlays: [{ component, path: options.path }] } : {}),
  });
}

function templateVars(pairs: string[]): Record<string, string> {
  return Object.fromEntries(
    pairs.map((pair) => {
      const index = pair.indexOf("=");
      if (index < 1) throw new Error(`Variable inválida: ${pair}. Usa clave=valor.`);
      return [pair.slice(0, index), pair.slice(index + 1)];
    }),
  );
}

function defineTemplateFeature(
  document: YAML.Document,
  name: string,
  options: FeatureDefinition,
  packages: Record<string, string>,
  root: string,
): void {
  const vars = templateVars(options.var ?? []);
  document.setIn(["features", name], {
    description: options.description,
    ...(options.path ? { path: options.path } : {}),
    ...common(options),
    ...(options.uses ? { uses: options.uses } : {}),
    ...(Object.keys(vars).length ? { vars } : {}),
    ...(Object.keys(packages).length ? { packages } : {}),
  });
  validateTemplateManifest(parseTemplateManifest(document.toString()), filesUnder(root));
}

function blockStyle(document: YAML.Document): void {
  YAML.visit(document, {
    Map: (_key, node) => {
      node.flow = false;
    },
    Seq: (_key, node) => {
      node.flow = false;
    },
  });
}

export function defineFeature(
  directory: string,
  name: string,
  options: FeatureDefinition,
): { file: string; isPackage: boolean } {
  const root = resolve(directory);
  const packages = Object.fromEntries(
    (options.package ?? []).map((spec) => {
      const parsed = parseSpec(spec, root);
      return [parsed.name, parsed.value || "*"];
    }),
  );
  const { isPackage, file } = featureFile(root);
  if (isPackage && (options.var?.length || options.uses)) throw new Error("--var y --uses solo existen en templates");
  const document = openDocument(file);
  if (isPackage) definePackageFeature(document, name, options, packages);
  else defineTemplateFeature(document, name, options, packages, root);
  blockStyle(document);
  if (isPackage) normalizeManifest(YAML.parse(document.toString()));
  writeFileSync(file, document.toString(), "utf8");
  return { file, isPackage };
}

export function undefineFeature(directory: string, name: string): string {
  const { isPackage, file } = featureFile(resolve(directory));
  if (!existsSync(file)) throw new Error(`No existe ${file}`);
  const document = YAML.parseDocument(readFileSync(file, "utf8"));
  const path = isPackage ? ["spec", "features", name] : ["features", name];
  if (!document.hasIn(path)) throw new Error(`${file} no declara la feature ${name}`);
  document.deleteIn(path);
  writeFileSync(file, document.toString(), "utf8");
  return file;
}
