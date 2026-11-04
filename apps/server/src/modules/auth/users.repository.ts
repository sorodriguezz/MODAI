import type { Insertable, Selectable, Updateable } from "kysely";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import type { UsersTable } from "../../infrastructure/database/schema.js";
import { toNumber } from "../../infrastructure/database/sql-helpers.js";
import { removeGrant } from "./grants.repository.js";
import { personalNamespace, type Role, type UserRecord } from "./identity.js";

export type UserRow = Selectable<UsersTable>;

export const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  role: row.role as Role,
  projectIds: JSON.parse(row.project_ids_json),
  organizationIds: JSON.parse(row.organization_ids_json),
  packageScopes: JSON.parse(row.package_scopes_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
  ...(row.disabled_at ? { disabledAt: row.disabled_at } : {}),
});

export class UsersRepository {
  constructor(private readonly context: DataContext) {}

  findById(id: string): Promise<UserRow | undefined> {
    return this.context.db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByUsername(username: string): Promise<UserRow | undefined> {
    return this.context.db.selectFrom("users").selectAll().where("username", "=", username).executeTakeFirst();
  }

  list(): Promise<UserRow[]> {
    return this.context.db.selectFrom("users").selectAll().orderBy("username").execute();
  }

  async count(context: DataContext = this.context): Promise<number> {
    const row = await context.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll().as("n"))
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async activeAdminCount(): Promise<number> {
    const row = await this.context.db
      .selectFrom("users")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("role", "=", "admin")
      .where("disabled_at", "is", null)
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async insert(row: Insertable<UsersTable>, context: DataContext = this.context): Promise<void> {
    await withTransaction(context, async (trx) => {
      await trx.db.insertInto("users").values(row).execute();
      await trx.db
        .insertInto("namespaces")
        .values({
          name: personalNamespace(row.username),
          organization_id: null,
          owner_user_id: row.id,
          description: `Namespace personal de ${row.username}`,
          visibility: "internal",
          created_by: row.id,
          created_at: row.created_at,
          updated_at: row.created_at,
        })
        .execute();
    });
  }

  namespaceTaken(name: string, context: DataContext = this.context): Promise<{ name: string } | undefined> {
    return context.db.selectFrom("namespaces").select("name").where("name", "=", name).executeTakeFirst();
  }

  async ownedNamespaces(id: string): Promise<string[]> {
    const rows = await this.context.db
      .selectFrom("namespaces")
      .select("name")
      .where("owner_user_id", "=", id)
      .execute();
    return rows.map((row) => row.name);
  }

  async update(id: string, fields: Updateable<UsersTable>): Promise<void> {
    await this.context.db.updateTable("users").set(fields).where("id", "=", id).execute();
  }

  async setLastLogin(id: string, at: string): Promise<void> {
    await this.context.db.updateTable("users").set({ last_login_at: at }).where("id", "=", id).execute();
  }

  async deleteRevokingKeys(id: string, at: string, namespaces: string[]): Promise<void> {
    await withTransaction(this.context, async (trx) => {
      await trx.db
        .updateTable("api_keys")
        .set({ revoked_at: at })
        .where("owner_user_id", "=", id)
        .where("revoked_at", "is", null)
        .execute();
      for (const namespace of namespaces) await removeGrant(trx, "package_scopes_json", namespace);
      await trx.db.deleteFrom("namespaces").where("owner_user_id", "=", id).execute();
      await trx.db.deleteFrom("users").where("id", "=", id).execute();
    });
  }
}
