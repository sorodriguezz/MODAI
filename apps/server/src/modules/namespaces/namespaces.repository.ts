import type { Insertable, Updateable } from "kysely";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import type { NamespacesTable } from "../../infrastructure/database/schema.js";
import { escapeLike, likeLower } from "../../infrastructure/database/sql-helpers.js";
import { removeGrant } from "../auth/grants.repository.js";

export class NamespacesRepository {
  constructor(private readonly context: DataContext) {}

  list() {
    return this.context.db
      .selectFrom("namespaces as n")
      .leftJoin("organizations as o", "o.id", "n.organization_id")
      .leftJoin("users as u", "u.id", "n.owner_user_id")
      .select([
        "n.name",
        "n.organization_id",
        "o.name as organization_name",
        "n.owner_user_id",
        "u.username as owner_username",
        "n.description",
        "n.visibility",
        "n.created_at",
        "n.updated_at",
      ])
      .orderBy("n.name")
      .execute();
  }

  async activePackageNames(): Promise<string[]> {
    const rows = await this.context.db
      .selectFrom("packages")
      .select("name")
      .distinct()
      .where("status", "<>", "yanked")
      .execute();
    return rows.map((row) => row.name);
  }

  async publishedVersions(namespace: string): Promise<number> {
    const rows = await this.context.db
      .selectFrom("packages")
      .select("name")
      .where(likeLower("name", `${escapeLike(namespace.toLowerCase())}/%`))
      .execute();
    return rows.filter((row) => row.name.startsWith(`${namespace}/`)).length;
  }

  async exists(name: string): Promise<boolean> {
    return Boolean(
      await this.context.db.selectFrom("namespaces").select("name").where("name", "=", name).executeTakeFirst(),
    );
  }

  async insert(row: Insertable<NamespacesTable>): Promise<void> {
    await this.context.db.insertInto("namespaces").values(row).execute();
  }

  async userExists(id: string): Promise<boolean> {
    return Boolean(await this.context.db.selectFrom("users").select("id").where("id", "=", id).executeTakeFirst());
  }

  async update(name: string, fields: Updateable<NamespacesTable>): Promise<void> {
    await this.context.db.updateTable("namespaces").set(fields).where("name", "=", name).execute();
  }

  async delete(name: string): Promise<void> {
    await withTransaction(this.context, async (trx) => {
      await removeGrant(trx, "package_scopes_json", name);
      await trx.db.deleteFrom("namespaces").where("name", "=", name).execute();
    });
  }
}
