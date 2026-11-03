import { AppError } from "@modai/contracts/errors";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import type { ArtifactFile, PackageManifest } from "@modai/contracts/types";
import { normalizeManifest } from "./normalize.js";
import { createPackageValidation, type FeatureContributions } from "./package-validation.js";
import { validateAgents } from "./validate-agents.js";
import { assertUniqueContributionNames, checkContributions } from "./validate-contributions.js";
import { validateDependencies } from "./validate-dependencies.js";
import { validateFeatures } from "./validate-features.js";
import { validateArtifactFiles } from "./validate-files.js";
import { validateIncludes } from "./validate-includes.js";
import { validateAdapterTargets, validateProfile, validateTemplatePackage } from "./validate-kind.js";

export function validatePackage(raw: PackageManifest, files: ArtifactFile[]): PackageManifestV1 {
  const manifest = normalizeManifest(raw);
  const validation = createPackageValidation(manifest, validateArtifactFiles(files));
  validateDependencies(manifest);
  const { spec } = manifest;
  const all = [
    spec.contributes,
    ...Object.values(spec.features).map((feature) => feature.contributes),
  ] as FeatureContributions[];
  assertUniqueContributionNames(all);
  checkContributions(validation, spec.contributes, "");
  validateIncludes(spec.include, validation.paths);
  validateFeatures(validation, (contributes, where) => checkContributions(validation, contributes, where));
  validateAgents(manifest);
  validateAdapterTargets(validation);
  validateProfile(validation, all);
  validateTemplatePackage(validation, files);
  return manifest;
}

export function assertValid(raw: PackageManifest, files: ArtifactFile[]): PackageManifestV1 {
  try {
    return validatePackage(raw, files);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "INVALID_PACKAGE", (error as Error).message);
  }
}
