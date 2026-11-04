import type { Kysely } from "kysely";
import type { ColumnTypes } from "./column-types.js";

export async function createPackageTables(db: Kysely<unknown>, t: ColumnTypes): Promise<void> {
  await db.schema
    .createTable("packages")
    .addColumn("name", t.key(214), (col) => col.notNull())
    .addColumn("version", t.key(100), (col) => col.notNull())
    .addColumn("type", t.key(64), (col) => col.notNull())
    .addColumn("description", t.text, (col) => col.notNull())
    .addColumn("manifest_json", t.text, (col) => col.notNull())
    .addColumn("artifact_id", t.key(100), (col) => col.notNull())
    .addColumn("published_at", t.key(40), (col) => col.notNull())
    .addColumn("status", t.key(20), (col) => col.notNull())
    .addColumn("deprecated_message", t.text)
    .addColumn("signer_fingerprint", t.key(200))
    .addColumn("signature", t.text)
    .addColumn("quality_json", t.text)
    .addPrimaryKeyConstraint("pk_packages", ["name", "version"])
    .execute();
  await db.schema.createIndex("idx_packages_name").on("packages").column("name").execute();
  await db.schema.createIndex("idx_packages_type").on("packages").column("type").execute();
  await db.schema
    .createTable("artifacts")
    .addColumn("id", t.key(100), (col) => col.primaryKey())
    .addColumn("sha256", t.key(100), (col) => col.notNull())
    .addColumn("size_bytes", t.integer, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .execute();
  await db.schema
    .createTable("publishers")
    .addColumn("fingerprint", t.key(200), (col) => col.primaryKey())
    .addColumn("label", t.text)
    .addColumn("public_key", t.text, (col) => col.notNull())
    .addColumn("trusted", t.integer, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .execute();
}

export async function createOperationTables(db: Kysely<unknown>, t: ColumnTypes): Promise<void> {
  await db.schema
    .createTable("audit_log")
    .addColumn("id", t.key(100), (col) => col.primaryKey())
    .addColumn("actor", t.text, (col) => col.notNull())
    .addColumn("action", t.key(100), (col) => col.notNull())
    .addColumn("resource", t.text, (col) => col.notNull())
    .addColumn("details_json", t.text, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .execute();
  await db.schema.createIndex("idx_audit_created").on("audit_log").column("created_at desc").execute();
  await db.schema
    .createTable("categories")
    .addColumn("name", t.key(64), (col) => col.primaryKey())
    .addColumn("description", t.text, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("updated_at", t.key(40), (col) => col.notNull())
    .execute();
}
