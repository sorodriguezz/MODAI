import type { DataContext } from "../../infrastructure/database/database.js";
import type { Identity } from "./identity.js";
import { packageVisibilityFilter, readableNamespaces } from "./namespace-access.js";

export interface ProjectOwnership {
  id: string;
  organizationId: string | null;
  createdBy: string;
}

export class AuthorizationRepository {
  constructor(private readonly context: DataContext) {}

  readableNamespaces(actor: Identity) {
    return readableNamespaces(this.context.db, actor).execute();
  }

  packageVisibility(actor: Identity) {
    return packageVisibilityFilter(this.context.dialect, actor);
  }

  async namespacesOfUser(userId: string | undefined): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.context.db
      .selectFrom("namespaces")
      .select("name")
      .where("owner_user_id", "=", userId)
      .orderBy("name")
      .execute();
    return rows.map((row) => row.name);
  }

  namespaceExists(name: string): Promise<{ name: string } | undefined> {
    return this.context.db.selectFrom("namespaces").select("name").where("name", "=", name).executeTakeFirst();
  }

  async namespacesOfOrganizations(organizationIds: string[]): Promise<string[]> {
    if (!organizationIds.length) return [];
    const rows = await this.context.db
      .selectFrom("namespaces")
      .select("name")
      .where("organization_id", "in", organizationIds)
      .orderBy("name")
      .execute();
    return rows.map((row) => row.name);
  }

  projectOrganization(id: string): Promise<{ organizationId: string | null } | undefined> {
    return this.context.db
      .selectFrom("projects")
      .select("organization_id as organizationId")
      .where("id", "=", id)
      .executeTakeFirst();
  }

  namespaceOrganization(name: string): Promise<{ organizationId: string | null } | undefined> {
    return this.context.db
      .selectFrom("namespaces")
      .select("organization_id as organizationId")
      .where("name", "=", name)
      .executeTakeFirst();
  }

  async organizations(ids?: string[]): Promise<Array<{ id: string; name: string }>> {
    if (ids && !ids.length) return [];
    let query = this.context.db.selectFrom("organizations").select(["id", "name"]);
    if (ids) query = query.where("id", "in", ids);
    return query.orderBy("name").execute();
  }

  projectOwnerships(): Promise<ProjectOwnership[]> {
    return this.context.db
      .selectFrom("projects")
      .select(["id", "organization_id as organizationId", "created_by as createdBy"])
      .execute();
  }
}
