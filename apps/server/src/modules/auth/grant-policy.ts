import { AppError, invariant } from "@modai/contracts/errors";
import type { AuthorizationService } from "./authorization.service.js";
import { DELEGABLE_ROLES, type Identity, type KeyGrants, ROLES, type Role } from "./identity.js";

async function assertProjectsInside(authz: AuthorizationService, projectIds: string[], organizations: string[]) {
  for (const projectId of projectIds) {
    const project = await authz.repository.projectOrganization(projectId);
    if (!project) throw new AppError(400, "PROJECT_NOT_FOUND", `No existe el proyecto ${projectId}`);
    if (!project.organizationId || !organizations.includes(project.organizationId))
      throw new AppError(
        400,
        "PROJECT_OUTSIDE_ORGANIZATION",
        `El proyecto ${projectId} no pertenece a las organizaciones asignadas`,
      );
  }
}

async function assertNamespacesInside(authz: AuthorizationService, scopes: string[], organizations: string[]) {
  for (const scope of scopes) {
    if (scope === "*")
      throw new AppError(
        403,
        "NAMESPACE_FORBIDDEN",
        "Solo la administración global puede dar acceso a todos los namespaces",
      );
    const namespace = await authz.repository.namespaceOrganization(scope);
    if (!namespace) throw new AppError(400, "NAMESPACE_NOT_FOUND", `No existe el namespace ${scope}`);
    if (!namespace.organizationId || !organizations.includes(namespace.organizationId))
      throw new AppError(
        400,
        "NAMESPACE_OUTSIDE_ORGANIZATION",
        `El namespace ${scope} no pertenece a las organizaciones asignadas`,
      );
  }
}

export async function assertGrants(
  authz: AuthorizationService,
  actor: Identity,
  role: Role,
  grants: KeyGrants,
): Promise<void> {
  invariant(ROLES.includes(role), 400, "INVALID_ROLE", "Rol inválido");
  const managed = authz.managedOrganizations(actor);
  if (managed === undefined) return;
  if (!DELEGABLE_ROLES.includes(role))
    throw new AppError(403, "ROLE_FORBIDDEN", "Solo la administración global puede asignar el rol de administración");
  const organizations = grants.organizationIds ?? [];
  invariant(organizations.length > 0, 400, "ORGANIZATION_REQUIRED", "Asigna al menos una organización");
  const outside = organizations.filter((id) => !managed.includes(id));
  if (outside.length)
    throw new AppError(403, "ORGANIZATION_FORBIDDEN", `No administras estas organizaciones: ${outside.join(", ")}`);
  await assertProjectsInside(authz, grants.projectIds ?? [], organizations);
  await assertNamespacesInside(authz, grants.packageScopes ?? [], organizations);
}
