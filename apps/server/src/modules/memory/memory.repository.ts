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
      .select(["project_id as projectId", "scope", "organization_id as organizationId", "session_id as sessionId"])
      .where("id", "=", id)
      .executeTakeFirst();
  }

  list(scope: MemoryScope, limit: number) {
    const query = this.context.db
      .selectFrom("memories")
      .select(MEMORY_COLUMNS)
      .where((eb) => memoryScopeFilter(eb, scope))
      .orderBy("memories.updated_at", "desc");
    return limitRows(query, this.context.dialect, limit).execute();
  }

  async update(id: string, fields: Updateable<MemoriesTable>): Promise<void> {
    await this.context.db.updateTable("memories").set(fields).where("id", "=", id).execute();
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
      ])
      .execute();
  }
}
