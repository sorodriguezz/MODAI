import type { Insertable } from "kysely";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import type { ProjectsTable } from "../../infrastructure/database/schema.js";
import { affectedRows, toNumber } from "../../infrastructure/database/sql-helpers.js";
import { removeGrant } from "../auth/grants.repository.js";

export interface ProjectRow {
  id: string;
  name: string;
  organizationId: string | null;
  createdBy: string;
  createdAt: string;
}

export class ProjectsRepository {
  constructor(private readonly context: DataContext) {}

  findById(id: string): Promise<ProjectRow | undefined> {
    return this.context.db
      .selectFrom("projects")
      .select(["id", "name", "organization_id as organizationId", "created_by as createdBy", "created_at as createdAt"])
      .where("id", "=", id)
      .executeTakeFirst();
  }

  listWithOrganization() {
    return this.context.db
      .selectFrom("projects as p")
      .leftJoin("organizations as o", "o.id", "p.organization_id")
      .select([
        "p.id",
        "p.name",
        "p.organization_id as organizationId",
        "o.name as organizationName",
        "p.created_by as createdBy",
        "p.created_at as createdAt",
      ])
      .orderBy("p.name")
      .execute();
  }

  async countByCreator(createdBy: string): Promise<number> {
    const row = await this.context.db
      .selectFrom("projects")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("created_by", "=", createdBy)
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async insert(row: Insertable<ProjectsTable>): Promise<void> {
    await this.context.db.insertInto("projects").values(row).execute();
  }

  async update(id: string, name: string, organizationId: string | null): Promise<void> {
    await this.context.db
      .updateTable("projects")
      .set({ name, organization_id: organizationId })
      .where("id", "=", id)
      .execute();
  }

  async liveRuns(id: string, now: string): Promise<number> {
    const row = await this.context.db
      .selectFrom("runs")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("project_id", "=", id)
      .where("status", "=", "running")
      .where("lease_expires_at", ">", now)
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  deleteCascade(id: string): Promise<{ memories: number; runs: number }> {
    return withTransaction(this.context, async ({ db, dialect }) => {
      const memories = await db
        .deleteFrom("memories")
        .where("project_id", "=", id)
        .where("scope", "!=", "organization")
        .executeTakeFirst();
      const runs = await db.deleteFrom("runs").where("project_id", "=", id).executeTakeFirst();
      await db.deleteFrom("project_installations").where("project_id", "=", id).execute();
      await removeGrant({ db, dialect }, "project_ids_json", id);
      await db.deleteFrom("projects").where("id", "=", id).execute();
      return { memories: affectedRows(memories), runs: affectedRows(runs) };
    });
  }
}
