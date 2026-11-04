import type { Insertable } from "kysely";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import type { ProjectInstallationsTable } from "../../infrastructure/database/schema.js";

export class UsageRepository {
  constructor(private readonly context: DataContext) {}

  async replace(projectId: string, rows: Array<Insertable<ProjectInstallationsTable>>): Promise<void> {
    await withTransaction(this.context, async ({ db }) => {
      await db.deleteFrom("project_installations").where("project_id", "=", projectId).execute();
      for (const row of rows) await db.insertInto("project_installations").values(row).execute();
    });
  }

  byPackage(name: string) {
    return this.context.db
      .selectFrom("project_installations as i")
      .innerJoin("projects as p", "p.id", "i.project_id")
      .select([
        "i.project_id as projectId",
        "p.name as projectName",
        "i.version",
        "i.direct",
        "i.reported_at as reportedAt",
      ])
      .where("i.package_name", "=", name)
      .orderBy("p.name")
      .execute();
  }

  all() {
    return this.context.db
      .selectFrom("project_installations")
      .select([
        "project_id as projectId",
        "package_name as packageName",
        "version",
        "direct",
        "reported_at as reportedAt",
      ])
      .orderBy("project_id")
      .orderBy("package_name")
      .execute();
  }

  async restore(row: Insertable<ProjectInstallationsTable>): Promise<void> {
    const current = await this.context.db
      .selectFrom("project_installations")
      .select("reported_at")
      .where("project_id", "=", row.project_id)
      .where("package_name", "=", row.package_name)
      .executeTakeFirst();
    if (!current) {
      await this.context.db.insertInto("project_installations").values(row).execute();
      return;
    }
    if (row.reported_at <= current.reported_at) return;
    await this.context.db
      .updateTable("project_installations")
      .set({ version: row.version, direct: row.direct, reported_at: row.reported_at })
      .where("project_id", "=", row.project_id)
      .where("package_name", "=", row.package_name)
      .execute();
  }
}
