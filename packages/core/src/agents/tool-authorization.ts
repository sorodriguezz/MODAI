import type { LockedPackageV1 } from "@modai/contracts/manifest";
import type { PackageGrant } from "../projects/project-grants.js";

export const INSTALL_PERMISSIONS: readonly string[] = ["project.instructions", "project.files", "project.source"];

export interface Authorization {
  allowed: boolean;
  missing: string[];
  reason?: string;
}

export function authorize(locked: LockedPackageV1 | undefined, grant: PackageGrant | undefined): Authorization {
  if (!locked) return { allowed: false, missing: [], reason: "Paquete no instalado" };
  const required = locked.permissions.filter((permission) => !INSTALL_PERMISSIONS.includes(permission));
  if (!grant)
    return {
      allowed: false,
      missing: required,
      reason: "No autorizado en este equipo; revisa sus permisos y ejecuta modai permissions grant <paquete>",
    };
  if (grant.integrity !== locked.integrity)
    return {
      allowed: false,
      missing: required,
      reason:
        "El contenido del paquete cambió desde la autorización; revisa y vuelve a ejecutar modai permissions grant",
    };
  if (!sameFeatures(grant.features, locked.features))
    return {
      allowed: false,
      missing: required,
      reason: `Las features cambiaron desde la autorización (ahora: ${locked.features.join(", ") || "ninguna"}); revisa sus herramientas y vuelve a ejecutar modai permissions grant`,
    };
  const missing = required.filter((permission) => !grant.permissions.includes(permission));
  return {
    allowed: missing.length === 0,
    missing,
    reason: missing.length ? `Faltan permisos: ${missing.join(", ")}` : undefined,
  };
}

export const sameFeatures = (granted: string[] | undefined, applied: string[]) =>
  [...(granted ?? [])].sort().join(",") === [...applied].sort().join(",");
