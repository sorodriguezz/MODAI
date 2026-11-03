import YAML from "yaml";
import { featureNameProblem } from "../packages/feature-rules.js";
import { parseTemplateFeature } from "./template-feature.js";
import {
  isPlainObject,
  stringList,
  TEMPLATE_NAME,
  type TemplateFeature,
  type TemplateManifest,
  templateProblem,
} from "./template-types.js";

export {
  TEMPLATE_MANIFEST,
  type TemplateFeature,
  type TemplateFile,
  type TemplateManifest,
  type TemplatePackage,
} from "./template-types.js";

function parseYaml(text: string): unknown {
  try {
    return YAML.parse(text);
  } catch (error) {
    return templateProblem(`no es YAML válido: ${(error as Error).message}`);
  }
}

function parseAddon(value: unknown): TemplateManifest["addon"] {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return templateProblem('"addon" es un objeto');
  const addon = { for: stringList(value.for, "addon.for") };
  for (const base of addon.for)
    if (!TEMPLATE_NAME.test(base)) templateProblem(`addon.for contiene "${base}", que no es @namespace/nombre`);
  return addon;
}

export function parseTemplateManifest(text: string): TemplateManifest {
  const raw = parseYaml(text);
  if (raw === null || raw === undefined) return { features: [] };
  if (!isPlainObject(raw)) return templateProblem('debe ser un objeto con "features" y/o "addon"');
  for (const key of Object.keys(raw))
    if (!["features", "addon"].includes(key)) templateProblem(`clave desconocida "${key}" (usa "features" o "addon")`);
  if (raw.features !== undefined && !isPlainObject(raw.features))
    templateProblem('"features" es un mapa nombre → definición');
  const features: TemplateFeature[] = [];
  for (const [name, value] of Object.entries((raw.features ?? {}) as Record<string, unknown>)) {
    const nameProblem = featureNameProblem(name);
    if (nameProblem) templateProblem(nameProblem);
    features.push(parseTemplateFeature(name, value ?? {}));
  }
  const addon = parseAddon(raw.addon);
  return { features, ...(addon ? { addon } : {}) };
}
