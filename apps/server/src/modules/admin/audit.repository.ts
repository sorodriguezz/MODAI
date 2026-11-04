import type { Insertable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { AuditLogTable } from "../../infrastructure/database/schema.js";
import { affectedRows, limitRows, toNumber } from "../../infrastructure/database/sql-helpers.js";

export class AuditRepository {
  constructor(private readonly context: DataContext) {}

  async insert(row: Insertable<AuditLogTable>): Promise<void> {
    await this.context.db.insertInto("audit_log").values(row).execute();
  }

  list(limit: number) {
    const query = this.context.db
      .selectFrom("audit_log")
      .select(["id", "actor", "action", "resource", "details_json as detailsJson", "created_at as createdAt"])
      .orderBy("created_at", "desc");
    return limitRows(query, this.context.dialect, limit).execute();
  }

  async countBefore(cutoff: string): Promise<number> {
    const row = await this.context.db
      .selectFrom("audit_log")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("created_at", "<", cutoff)
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async deleteBefore(cutoff: string): Promise<number> {
    const result = await this.context.db.deleteFrom("audit_log").where("created_at", "<", cutoff).executeTakeFirst();
    return affectedRows(result);
  }
}
