import { AppError, invariant } from "@modai/contracts/errors";
import type { ArtifactFile } from "@modai/contracts/types";
import { adapterTargetPermission } from "../installation/targets.js";
import { parseTemplateManifest, TEMPLATE_MANIFEST } from "../templates/template-manifest.js";
import { validateTemplateManifest } from "../templates/validate-template-manifest.js";
import type { FeatureContributions, PackageValidation } from "./package-validation.js";

export function validateAdapterTargets(validation: PackageValidation): void {
  const adapter = validation.manifest.spec.adapter;
  if (!adapter) return;
  const { targets } = adapter;
  const templates = [
    targets.skills?.path,
    targets.rules?.mode === "block" ? targets.rules.file : targets.rules?.path,
    targets.index?.file,
    targets.mcp?.file,
  ].filter((value): value is string => Boolean(value));
  for (const template of templates) {
    const sample = template.replace(/\{[a-z]+\}/g, "sample");
    if (adapterTargetPermission(sample))
      validation.requirePermission("project.instructions", `El adaptador que escribe ${template}`);
  }
}

export function validateProfile(validation: PackageValidation, all: FeatureContributions[]): void {
  if (validation.manifest.kind !== "Profile") return;
  invariant(
    all.every((item) => item.tools.length === 0 && item.mcpServers.length === 0),
    400,
    "INVALID_PROFILE",
    "Un Profile compone paquetes; las herramientas viven en paquetes propios",
  );
}

export function validateTemplatePackage(validation: PackageValidation, files: ArtifactFile[]): void {
  if (validation.manifest.kind !== "Template") return;
  invariant(files.length > 0, 400, "INVALID_TEMPLATE", "El template no tiene archivos");
  const declaration = files.find((file) => file.path === TEMPLATE_MANIFEST);
  if (!declaration) return;
  try {
    const text = Buffer.from(declaration.content, "base64").toString("utf8");
    validateTemplateManifest(parseTemplateManifest(text), [...validation.paths]);
  } catch (error) {
    throw new AppError(400, "INVALID_TEMPLATE_MANIFEST", (error as Error).message);
  }
}
