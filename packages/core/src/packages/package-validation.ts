import { invariant } from "@modai/contracts/errors";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import { assertSafeRelativePath } from "@modai/contracts/security";

export type FeatureContributions = Omit<PackageManifestV1["spec"]["contributes"], "agents">;

export interface PackageValidation {
  manifest: PackageManifestV1;
  paths: Set<string>;
  requirePermission(permission: string, reason: string): void;
  exists(path: string, label: string): void;
}

export function createPackageValidation(manifest: PackageManifestV1, paths: Set<string>): PackageValidation {
  const declared = new Set<string>(manifest.spec.permissions);
  return {
    manifest,
    paths,
    requirePermission: (permission, reason) =>
      invariant(
        declared.has(permission),
        400,
        "PERMISSION_UNDECLARED",
        `${reason} requiere declarar el permiso ${permission}`,
      ),
    exists: (path, label) => {
      assertSafeRelativePath(path, label);
      invariant(paths.has(path), 400, "MISSING_SOURCE", `No existe el archivo fuente ${path}`);
    },
  };
}
