import { AppError, invariant } from "@modai/contracts/errors";
import type { AuthorizationService } from "./authorization.service.js";
import { type Identity, type KeyGrants, ROLES, type Role, type UserRecord, userIdentity } from "./identity.js";

interface Ceiling {
  all: boolean;
  projects: Set<string>;
  organizations: Set<string>;
  scopes: Set<string>;
  anyScope: boolean;
}

export function keyRoleAllowed(authz: AuthorizationService, ownerRole: Role, keyRole: Role): boolean {
  return authz.satisfies(ownerRole, keyRole) || (keyRole === "worker" && authz.satisfies(ownerRole, "publisher"));
}

async function ownerCeiling(authz: AuthorizationService, owner: Identity): Promise<Ceiling> {
  if (owner.role === "admin")
    return { all: true, projects: new Set(), organizations: new Set(), scopes: new Set(), anyScope: true };
  const rows = await authz.repository.projectOwnerships();
  const projects = new Set(rows.filter((row) => authz.seesProject(owner, row)).map((row) => row.id));
  const managed = owner.role === "org-admin" ? (await authz.managedNamespaces(owner)).namespaces : [];
  return {
    all: false,
    projects,
    organizations: new Set(owner.organizationIds),
    scopes: new Set([...owner.packageScopes, ...managed]),
    anyScope: owner.packageScopes.includes("*"),
  };
}

const scopeAllowed = (ceiling: Ceiling, scope: string) =>
  ceiling.anyScope || (scope !== "*" && ceiling.scopes.has(scope));

export async function boundToOwner(
  authz: AuthorizationService,
  owner: Identity,
  role: Role,
  grants: Required<KeyGrants>,
  inherit: boolean,
): Promise<Identity | undefined> {
  if (!keyRoleAllowed(authz, owner.role, role)) return undefined;
  if (inherit) return { ...owner, role };
  const ceiling = await ownerCeiling(authz, owner);
  if (ceiling.all) return { ...owner, role, ...grants };
  return {
    ...owner,
    role,
    projectIds: grants.projectIds.filter((id) => ceiling.projects.has(id)),
    organizationIds: grants.organizationIds.filter((id) => ceiling.organizations.has(id)),
    packageScopes: grants.packageScopes.filter((scope) => scopeAllowed(ceiling, scope)),
  };
}

export async function assertKeyWithinOwner(
  authz: AuthorizationService,
  owner: UserRecord,
  role: Role,
  grants: KeyGrants,
  inherit: boolean,
): Promise<void> {
  invariant(ROLES.includes(role), 400, "INVALID_ROLE", "Rol inválido");
  if (owner.disabledAt) throw new AppError(409, "OWNER_DISABLED", `${owner.username} está desactivado`);
  if (!keyRoleAllowed(authz, owner.role, role))
    throw new AppError(
      403,
      "KEY_EXCEEDS_OWNER",
      `Una API key de ${owner.username} no puede tener el rol ${role}: su cuenta es ${owner.role}`,
    );
  if (inherit || owner.role === "admin") return;
  const ceiling = await ownerCeiling(authz, userIdentity(owner));
  const outside = [
    ...(grants.organizationIds ?? []).filter((id) => !ceiling.organizations.has(id)).map((id) => `organización ${id}`),
    ...(grants.projectIds ?? []).filter((id) => !ceiling.projects.has(id)).map((id) => `proyecto ${id}`),
    ...(grants.packageScopes ?? [])
      .filter((scope) => !scopeAllowed(ceiling, scope))
      .map((scope) => `namespace ${scope}`),
  ];
  if (outside.length)
    throw new AppError(
      403,
      "KEY_EXCEEDS_OWNER",
      `La API key no puede tener más acceso que ${owner.username}: ${outside.join(", ")}`,
    );
}
