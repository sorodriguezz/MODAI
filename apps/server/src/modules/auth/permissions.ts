import type { AuthorizationService } from "./authorization.service.js";
import { DELEGABLE_ROLES, type Identity, type Permissions, ROLES, WRITER_ROLES } from "./identity.js";

export async function permissionsOf(authz: AuthorizationService, identity: Identity | undefined): Promise<Permissions> {
  const actor = authz.require(identity, "reader");
  const global = actor.role === "admin",
    manager = global || actor.role === "org-admin";
  const rows = await authz.repository.organizations(global ? undefined : actor.organizationIds);
  const publish = await authz.publishableNamespaces(actor);
  return {
    role: actor.role,
    global,
    manage: {
      users: manager,
      apiKeys: manager,
      organizations: manager,
      createOrganizations: global,
      namespaces: manager,
      audit: global,
      publishers: global,
      backup: global,
      packages: global,
    },
    assignableRoles: global ? ROLES : manager ? DELEGABLE_ROLES : [],
    createProjects: authz.satisfies(actor.role, "publisher"),
    writeKnowledge: global,
    writeMemory: WRITER_ROLES.includes(actor.role),
    submitRuns: authz.satisfies(actor.role, "publisher"),
    publish,
    packages: await authz.managedNamespaces(actor),
    organizations: rows.map((row) => ({ ...row, manage: authz.administers(actor, row.id) && manager })),
  };
}
