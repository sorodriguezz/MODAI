import { assertSafeRelativePath } from "@modai/contracts/security";
import { assertFeatureRules } from "../packages/feature-rules.js";
import { TEMPLATE_MANIFEST, type TemplateFeature, type TemplateManifest, templateProblem } from "./template-types.js";

const doesNothing = (feature: TemplateFeature) =>
  !feature.path &&
  !feature.uses &&
  !Object.keys(feature.vars).length &&
  !feature.requires.length &&
  !Object.keys(feature.packages).length;

function assertFeatureFolder(feature: TemplateFeature & { path: string }, folders: string[], paths: string[]): void {
  assertSafeRelativePath(feature.path, `path de ${feature.name}`);
  if (!paths.some((path) => path.startsWith(`${feature.path}/`)))
    templateProblem(`la carpeta "${feature.path}" de "${feature.name}" no existe o está vacía en el template`);
  for (const other of folders)
    if (other !== feature.path && (other.startsWith(`${feature.path}/`) || feature.path.startsWith(`${other}/`)))
      templateProblem(`las carpetas "${feature.path}" y "${other}" se anidan; cada feature necesita la suya`);
}

export function validateTemplateManifest(manifest: TemplateManifest, paths: string[]): void {
  try {
    assertFeatureRules(manifest.features, TEMPLATE_MANIFEST);
  } catch (error) {
    throw new Error((error as Error).message);
  }
  const folders = manifest.features.filter((feature) => feature.path).map((feature) => feature.path!);
  for (const feature of manifest.features) {
    if (doesNothing(feature))
      templateProblem(`la feature "${feature.name}" no hace nada: añade path, uses, vars, packages o requires`);
    if (feature.path) assertFeatureFolder(feature as TemplateFeature & { path: string }, folders, paths);
  }
}
