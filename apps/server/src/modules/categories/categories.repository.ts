import type { Insertable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { CategoriesTable } from "../../infrastructure/database/schema.js";
import { affectedRows } from "../../infrastructure/database/sql-helpers.js";

export class CategoriesRepository {
  constructor(private readonly context: DataContext) {}

  activeManifests() {
    return this.context.db
      .selectFrom("packages")
      .select(["name", "manifest_json"])
      .where("status", "<>", "yanked")
      .execute();
  }

  list() {
    return this.context.db
      .selectFrom("categories")
      .select(["name", "description", "created_at", "updated_at"])
      .execute();
  }

  async exists(name: string): Promise<boolean> {
    return Boolean(
      await this.context.db.selectFrom("categories").select("name").where("name", "=", name).executeTakeFirst(),
    );
  }

  async insert(row: Insertable<CategoriesTable>): Promise<void> {
    await this.context.db.insertInto("categories").values(row).execute();
  }

  async update(name: string, description: string): Promise<number> {
    const result = await this.context.db
      .updateTable("categories")
      .set({ description, updated_at: new Date().toISOString() })
      .where("name", "=", name)
      .executeTakeFirst();
    return affectedRows(result);
  }

  async delete(name: string): Promise<number> {
    return affectedRows(await this.context.db.deleteFrom("categories").where("name", "=", name).executeTakeFirst());
  }
}
