import { type Kysely, sql } from "kysely";
import type { ColumnTypes } from "./column-types.js";

export async function createAuthTables(db: Kysely<unknown>, t: ColumnTypes): Promise<void> {
  await db.schema
    .createTable("users")
    .addColumn("id", t.key(100), (col) => col.primaryKey())
    .addColumn("username", t.key(200), (col) => col.notNull().unique())
    .addColumn("display_name", t.text, (col) => col.notNull())
    .addColumn("password_hash", t.text, (col) => col.notNull())
    .addColumn("role", t.key(20), (col) => col.notNull())
    .addColumn("project_ids_json", t.text, (col) => col.notNull())
    .addColumn("organization_ids_json", t.text, (col) => col.notNull())
    .addColumn("package_scopes_json", t.text, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("updated_at", t.key(40), (col) => col.notNull())
    .addColumn("last_login_at", t.key(40))
    .addColumn("disabled_at", t.key(40))
    .addCheckConstraint("ck_users_role", sql`role in ('reader', 'publisher', 'worker', 'org-admin', 'admin')`)
    .execute();
  await db.schema
    .createTable("sessions")
    .addColumn("token_hash", t.key(100), (col) => col.primaryKey())
    .addColumn("user_id", t.key(100), (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("last_seen_at", t.key(40), (col) => col.notNull())
    .addColumn("expires_at", t.key(40), (col) => col.notNull())
    .addColumn("absolute_expires_at", t.key(40), (col) => col.notNull())
    .addColumn("user_agent", t.text)
    .addColumn("ip", t.key(100))
    .addForeignKeyConstraint("fk_sessions_user", ["user_id"], "users", ["id"], (fk) => fk.onDelete("cascade"))
    .execute();
  await db.schema.createIndex("idx_sessions_user").on("sessions").column("user_id").execute();
  await db.schema.createIndex("idx_sessions_expiry").on("sessions").column("expires_at").execute();
  await db.schema
    .createTable("api_keys")
    .addColumn("id", t.key(100), (col) => col.primaryKey())
    .addColumn("label", t.text, (col) => col.notNull())
    .addColumn("token_hash", t.key(100), (col) => col.notNull().unique())
    .addColumn("role", t.key(20), (col) => col.notNull())
    .addColumn("project_ids_json", t.text, (col) => col.notNull())
    .addColumn("organization_ids_json", t.text, (col) => col.notNull())
    .addColumn("package_scopes_json", t.text, (col) => col.notNull())
    .addColumn("owner_user_id", t.key(100))
    .addColumn("inherit_grants", t.integer, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("last_used_at", t.key(40))
    .addColumn("revoked_at", t.key(40))
    .execute();
}
