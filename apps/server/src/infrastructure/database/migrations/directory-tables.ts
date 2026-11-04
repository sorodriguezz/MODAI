import { type Kysely, sql } from "kysely";
import type { DialectName } from "../database-url.js";
import type { ColumnTypes } from "./column-types.js";

export async function createDirectoryTables(db: Kysely<unknown>, t: ColumnTypes): Promise<void> {
  await db.schema
    .createTable("organizations")
    .addColumn("id", t.key(200), (col) => col.primaryKey())
    .addColumn("name", t.text, (col) => col.notNull())
    .addColumn("description", t.text, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("updated_at", t.key(40))
    .execute();
  await db.schema
    .createTable("projects")
    .addColumn("id", t.key(200), (col) => col.primaryKey())
    .addColumn("name", t.text, (col) => col.notNull())
    .addColumn("organization_id", t.key(200))
    .addColumn("created_by", t.key(200), (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addForeignKeyConstraint("fk_projects_organization", ["organization_id"], "organizations", ["id"])
    .execute();
  await db.schema.createIndex("idx_projects_owner").on("projects").column("created_by").execute();
  await db.schema.createIndex("idx_projects_org").on("projects").column("organization_id").execute();
  await db.schema
    .createTable("namespaces")
    .addColumn("name", t.key(200), (col) => col.primaryKey())
    .addColumn("organization_id", t.key(200))
    .addColumn("description", t.text, (col) => col.notNull())
    .addColumn("visibility", t.key(20), (col) => col.notNull())
    .addColumn("created_by", t.key(200), (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("updated_at", t.key(40), (col) => col.notNull())
    .addForeignKeyConstraint("fk_namespaces_organization", ["organization_id"], "organizations", ["id"])
    .addCheckConstraint("ck_namespaces_visibility", sql`visibility in ('internal', 'restricted')`)
    .execute();
  await db.schema.createIndex("idx_namespaces_org").on("namespaces").column("organization_id").execute();
  await db.schema
    .createTable("project_installations")
    .addColumn("project_id", t.key(200), (col) => col.notNull())
    .addColumn("package_name", t.key(214), (col) => col.notNull())
    .addColumn("version", t.key(100), (col) => col.notNull())
    .addColumn("direct", t.integer, (col) => col.notNull())
    .addColumn("reported_at", t.key(40), (col) => col.notNull())
    .addPrimaryKeyConstraint("pk_project_installations", ["project_id", "package_name"])
    .addForeignKeyConstraint("fk_installations_project", ["project_id"], "projects", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    .execute();
  await db.schema.createIndex("idx_installations_package").on("project_installations").column("package_name").execute();
}

export async function createRunTables(db: Kysely<unknown>, t: ColumnTypes, dialect: DialectName): Promise<void> {
  await db.schema
    .createTable("runs")
    .addColumn("id", t.key(100), (col) => col.primaryKey())
    .addColumn("project_id", t.key(200), (col) => col.notNull())
    .addColumn("agent_name", t.key(214), (col) => col.notNull())
    .addColumn("agent_version", t.key(100), (col) => col.notNull())
    .addColumn("task", t.text, (col) => col.notNull())
    .addColumn("bundle_json", t.text, (col) => col.notNull())
    .addColumn("status", t.key(20), (col) => col.notNull())
    .addColumn("result", t.text)
    .addColumn("error", t.text)
    .addColumn("attempts", t.integer, (col) => col.notNull())
    .addColumn("created_by", t.key(200), (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("updated_at", t.key(40), (col) => col.notNull())
    .addColumn("worker_id", t.key(200))
    .addColumn("lease_hash", t.key(100))
    .addColumn("lease_expires_at", t.key(40))
    .addColumn("idempotency_key", t.key(200))
    .addForeignKeyConstraint("fk_runs_project", ["project_id"], "projects", ["id"])
    .execute();
  const unique = db.schema
    .createIndex("uq_runs_idempotency")
    .unique()
    .on("runs")
    .columns(["project_id", "created_by", "idempotency_key"]);
  // why: SQL Server treats NULLs as equal in unique indexes, so the uniqueness only covers runs with a key.
  await (dialect === "mysql" ? unique : unique.where(sql.ref("idempotency_key"), "is not", null)).execute();
  await db.schema.createIndex("idx_runs_queue").on("runs").columns(["project_id", "status", "created_at"]).execute();
}
