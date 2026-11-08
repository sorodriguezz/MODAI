import { randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import type { TeamRecord } from "@modai/contracts/types";
import type { DataContext } from "../../infrastructure/database/database.js";
import { isUniqueViolation } from "../../infrastructure/database/sql-helpers.js";
import { insertIgnore } from "../../infrastructure/database/upsert.js";
import type { AuthorizationService } from "../auth/authorization.service.js";
import type { Identity } from "../auth/identity.js";
import { UsersRepository } from "../auth/users.repository.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";

const COLUMNS = ["id", "organization_id as organizationId", "name", "created_at as createdAt"] as const;

export class TeamsService {
  constructor(
    private readonly context: DataContext,
    private readonly authz: AuthorizationService,
    private readonly organizations: OrganizationsService,
  ) {}

  requireOrganizationManager(identity: Identity | undefined, organizationId: string): Identity {
    const actor = this.authz.requireManager(identity);
    invariant(
      this.authz.administers(actor, organizationId),
      403,
      "ORGANIZATION_FORBIDDEN",
      "No administras esa organización",
    );
    return actor;
  }

  async requireManagedTeam(identity: Identity | undefined, id: string): Promise<TeamRecord> {
    this.authz.requireManager(identity);
    const team = await this.context.db.selectFrom("teams").select(COLUMNS).where("id", "=", id).executeTakeFirst();
    invariant(team, 404, "TEAM_NOT_FOUND", "Equipo no encontrado");
    this.requireOrganizationManager(identity, team.organizationId);
    return team;
  }

  list(identity: Identity | undefined, organizationId: string): Promise<TeamRecord[]> {
    this.authz.requireOrganization(identity, organizationId);
    return this.context.db
      .selectFrom("teams")
      .select(COLUMNS)
      .where("organization_id", "=", organizationId)
      .orderBy("name")
      .orderBy("id")
      .execute();
  }

  async create(identity: Identity | undefined, organizationId: string, name: string): Promise<TeamRecord> {
    this.requireOrganizationManager(identity, organizationId);
    await this.organizations.requireOrganizationExists(organizationId);
    const team = { id: randomUUID(), organizationId, name, createdAt: new Date().toISOString() };
    try {
      await this.context.db
        .insertInto("teams")
        .values({
          id: team.id,
          organization_id: organizationId,
          name,
          created_at: team.createdAt,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, "TEAM_EXISTS", "Ya existe un equipo con ese nombre");
      throw error;
    }
    return team;
  }

  async delete(identity: Identity | undefined, id: string): Promise<void> {
    await this.requireManagedTeam(identity, id);
    await this.context.db.deleteFrom("teams").where("id", "=", id).execute();
  }

  async members(identity: Identity | undefined, teamId: string) {
    const team = await this.requireManagedTeam(identity, teamId);
    const rows = await this.context.db
      .selectFrom("team_memberships")
      .innerJoin("users", "users.id", "team_memberships.user_id")
      .select(["users.id", "users.username", "users.organization_ids_json", "users.disabled_at"])
      .where("team_memberships.team_id", "=", teamId)
      .orderBy("users.username")
      .execute();
    return rows.map(({ id, username, organization_ids_json, disabled_at }) => ({
      id,
      username,
      active: !disabled_at && (JSON.parse(organization_ids_json) as string[]).includes(team.organizationId),
    }));
  }

  async setMember(identity: Identity | undefined, teamId: string, userId: string, active: boolean): Promise<void> {
    const team = await this.requireManagedTeam(identity, teamId);
    if (!active) {
      await this.context.db
        .deleteFrom("team_memberships")
        .where("team_id", "=", teamId)
        .where("user_id", "=", userId)
        .execute();
      return;
    }
    const user = await new UsersRepository(this.context).findById(userId);
    invariant(
      user && !user.disabled_at && (JSON.parse(user.organization_ids_json) as string[]).includes(team.organizationId),
      400,
      "ORGANIZATION_MEMBER_REQUIRED",
      "El usuario debe ser miembro activo de la organización del equipo",
    );
    await insertIgnore(this.context, "team_memberships", { team_id: teamId, user_id: userId }, ["team_id", "user_id"]);
  }
}
