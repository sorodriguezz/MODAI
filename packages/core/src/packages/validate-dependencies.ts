import { invariant } from "@modai/contracts/errors";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import semver from "semver";

export function validateDependencies(manifest: PackageManifestV1): void {
  const { spec } = manifest;
  for (const [name, range] of Object.entries(spec.dependencies)) {
    invariant(Boolean(semver.validRange(range)), 400, "INVALID_DEPENDENCY", `Dependencia inválida: ${name}@${range}`);
    invariant(name !== manifest.metadata.name, 400, "INVALID_DEPENDENCY", "Un paquete no puede depender de sí mismo");
  }
  for (const requirement of [...spec.requires, ...spec.optional]) {
    invariant(
      Boolean(semver.validRange(requirement.version)),
      400,
      "INVALID_CAPABILITY_RANGE",
      `Rango inválido para ${requirement.capability}: ${requirement.version}`,
    );
  }
  const provided = new Set<string>();
  for (const capability of spec.provides) {
    invariant(
      !provided.has(capability.capability),
      400,
      "DUPLICATE_CAPABILITY",
      `Capacidad duplicada: ${capability.capability}`,
    );
    provided.add(capability.capability);
  }
}
