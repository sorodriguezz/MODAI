import type { Insertable, Updateable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { MemoriesTable } from "../../infrastructure/database/schema.js";
import {
  MEMORY_COLUMNS,
  type MemoryScope,
  memoryScopeFilter,
} from "../../infrastructure/database/search/text-search.js";
import { affectedRows, limitRows, toNumber } from "../../infrastructure/database/sql-helpers.js";

export class MemoryRepository {
  constructor(private readonly context: DataContext) {}

  async countForProject(projectId: string): Promise<number> {
    const row = await this.context.db
      .selectFrom("memories")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async insert(row: Insertable<MemoriesTable>): Promise<void> {
    await this.context.db.insertInto("memories").values(row).execute();
  }

  find(id: string) {
    return this.context.db.selectFrom("memories").selectAll().where("id", "=", id).executeTakeFirst();
  }

  access(id: string) {
    return this.context.db
      .selectFrom("memories")
      .select([
        "project_id as projectId",
        "scope",
        "organization_id as organizationId",
        "session_id as sessionId",
        "personal",
        "created_by as createdBy",
        "updated_at as updatedAt",
      ])
      .where("id", "=", id)
      .executeTakeFirst();
  }

  pending(organizationId: string, now: string) {
    const query = this.context.db
      .selectFrom("memories")
      .select(MEMORY_COLUMNS)
      .where("organization_id", "=", organizationId)
      .where("scope", "=", "organization")
      .where((eb) => eb.or([eb("approval", "=", 0), eb.and([eb("approval", "=", 1), eb("review_at", "<=", now)])]))
      .orderBy("updated_at")
      .orderBy("id");
    return limitRows(query, this.context.dialect, 100).execute();
  }

  async review(id: string, updatedAt: string, fields: Updateable<MemoriesTable>): Promise<boolean> {
    const result = await this.context.db
      .updateTable("memories")
      .set(fields)
      .where("id", "=", id)
      .where("updated_at", "=", updatedAt)
      .executeTakeFirst();
    return affectedRows(result) > 0;
  }

  list(scope: MemoryScope, limit: number) {
    const query = this.context.db
      .selectFrom("memories")
      .select(MEMORY_COLUMNS)
      .where((eb) => memoryScopeFilter(eb, scope))
      .orderBy("memories.updated_at", "desc");
    return limitRows(query, this.context.dialect, limit).execute();
  }

  async delete(id: string): Promise<void> {
    await this.context.db.deleteFrom("memories").where("id", "=", id).execute();
  }

  async countBefore(cutoff: string): Promise<number> {
    const row = await this.context.db
      .selectFrom("memories")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("updated_at", "<", cutoff)
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async deleteBefore(cutoff: string): Promise<number> {
    return affectedRows(
      await this.context.db.deleteFrom("memories").where("updated_at", "<", cutoff).executeTakeFirst(),
    );
  }

  exportAll() {
    return this.context.db
      .selectFrom("memories")
      .select([
        "project_id as projectId",
        "scope",
        "kind",
        "content",
        "metadata_json as metadataJson",
        "session_id as sessionId",
        "created_by as createdBy",
        "organization_id as organizationId",
        "approval",
        "reviewed_by as reviewedBy",
        "review_at as reviewAt",
      ])
      .where("personal", "=", 0)
      .execute();
  }
}
