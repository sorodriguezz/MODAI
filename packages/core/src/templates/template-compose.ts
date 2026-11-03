import { TEMPLATE_MANIFEST, type TemplateFile, type TemplateManifest, type TemplatePackage } from "./template-types.js";

const underFeature = (manifest: TemplateManifest, path: string) =>
  manifest.features.some((feature) => feature.path && path.startsWith(`${feature.path}/`));

export function baseFiles(files: TemplateFile[], manifest: TemplateManifest): TemplateFile[] {
  return files.filter((file) => file.path !== TEMPLATE_MANIFEST && !underFeature(manifest, file.path));
}

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

function mergePackages(packages: Record<string, TemplatePackage>, additions: Record<string, TemplatePackage>): void {
  for (const [pkg, spec] of Object.entries(additions)) {
    const previous = packages[pkg];
    packages[pkg] = {
      version: previous && previous.version !== "*" ? previous.version : spec.version,
      features: [...new Set([...(previous?.features ?? []), ...spec.features])],
    };
  }
}

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
    const prefix = `${feature.path}/`;
    if (feature.path)
      for (const file of input.files)
        if (file.path.startsWith(prefix)) put({ ...file, path: file.path.slice(prefix.length) });
    Object.assign(variables, feature.vars);
    mergePackages(packages, feature.packages);
  }
  for (const spec of input.extraAddons ?? []) layer(spec, "");
  return { files: [...result.values()], variables, packages, overwritten: [...overwritten].sort() };
}
