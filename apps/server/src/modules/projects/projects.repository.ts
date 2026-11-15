import { invariant } from "@modai/contracts/errors";
import { type Insertable, sql } from "kysely";
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

  async lock(id: string): Promise<{ organizationId: string | null } | undefined> {
    const { db, dialect } = this.context;
    const query = db.selectFrom("projects").select("organization_id as organizationId").where("id", "=", id);
    if (dialect === "sqlite") {
      await db
        .updateTable("projects")
        .set((eb) => ({ name: eb.ref("name") }))
        .where("id", "=", id)
        .execute();
      return query.executeTakeFirst();
    }
    if (dialect === "mssql")
      return (
        await sql<{
          organizationId: string | null;
        }>`select organization_id as organizationId from projects with (updlock, rowlock) where id = ${id}`.execute(db)
      ).rows[0];
    return query.forUpdate().executeTakeFirst();
  }

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

  async rename(id: string, name: string): Promise<void> {
    await this.context.db.updateTable("projects").set({ name }).where("id", "=", id).execute();
  }

  async transfer(id: string, name: string, previous: string | null, destination: string | null, creator: string) {
    await withTransaction(this.context, async (trx) => {
      const { db } = trx;
      const changed = await db
        .updateTable("projects")
        .set({ name, organization_id: destination, created_by: creator })
        .where("id", "=", id)
        .where("organization_id", previous === null ? "is" : "=", previous)
        .executeTakeFirst();
      invariant(affectedRows(changed), 409, "PROJECT_CHANGED", "La organización del proyecto cambió");
      const related = [
        "runs",
        "memories",
        "knowledge_documents",
        "project_installations",
        "capability_bindings",
        "project_execution_policies",
      ] as const;
      for (const table of related) {
        const existing = await db
          .selectFrom(table)
          .select("project_id")
          .where("project_id", "=", id)
          .executeTakeFirst();
        invariant(
          !existing,
          409,
          "PROJECT_HAS_CONTEXT",
          "Solo se pueden transferir proyectos sin memoria, documentos, tareas, instalaciones ni políticas",
        );
      }
      await removeGrant(trx, "project_ids_json", id);
    });
  }

  private async liveRuns(id: string, now: string): Promise<number> {
    const row = await this.context.db
      .selectFrom("runs")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("project_id", "=", id)
      .where("status", "=", "running")
      .where("lease_expires_at", ">", now)
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  deleteCascade(id: string, organizationId: string | null): Promise<{ memories: number; runs: number }> {
    return withTransaction(this.context, async (trx) => {
      const { db, dialect } = trx;
      const projects = new ProjectsRepository(trx);
      const locked = await projects.lock(id);
      invariant(locked, 404, "PROJECT_NOT_FOUND", "Proyecto no encontrado");
      invariant(
        locked.organizationId === organizationId,
        409,
        "PROJECT_CHANGED",
        "La organización del proyecto cambió",
      );
      const busy = await projects.liveRuns(id, new Date().toISOString());
      invariant(
        busy === 0,
        409,
        "PROJECT_BUSY",
        `Hay ${busy} ejecución(es) en curso en este proyecto; cancélalas o espera a que terminen`,
      );
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
