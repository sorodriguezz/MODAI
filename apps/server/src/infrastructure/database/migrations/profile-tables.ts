import { type Kysely, sql } from "kysely";
import type { ColumnTypes } from "./column-types.js";

export async function createProfileTables(db: Kysely<unknown>, t: ColumnTypes): Promise<void> {
  await db.schema
    .createTable("teams")
    .addColumn("id", t.key(100), (col) => col.primaryKey())
    .addColumn("organization_id", t.key(200), (col) => col.notNull())
    .addColumn("name", t.key(200), (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addForeignKeyConstraint("fk_team_organization", ["organization_id"], "organizations", ["id"])
    .addUniqueConstraint("uq_team_name", ["organization_id", "name"])
    .execute();
  await db.schema
    .createTable("team_memberships")
    .addColumn("team_id", t.key(100), (col) => col.notNull())
    .addColumn("user_id", t.key(200), (col) => col.notNull())
    .addPrimaryKeyConstraint("pk_team_memberships", ["team_id", "user_id"])
    .addForeignKeyConstraint("fk_membership_team", ["team_id"], "teams", ["id"], (fk) => fk.onDelete("cascade"))
    .addForeignKeyConstraint("fk_membership_user", ["user_id"], "users", ["id"], (fk) => fk.onDelete("cascade"))
    .execute();
  await db.schema.createIndex("idx_team_member_user").on("team_memberships").columns(["user_id", "team_id"]).execute();
  await db.schema
    .createTable("capability_bindings")
    .addColumn("id", t.key(64), (col) => col.primaryKey())
    .addColumn("organization_id", t.key(200))
    .addColumn("project_id", t.key(200))
    .addColumn("team_id", t.key(100))
    .addColumn("slot", t.key(214), (col) => col.notNull())
    .addColumn("package_name", t.key(214), (col) => col.notNull())
    .addColumn("version_range", t.key(100), (col) => col.notNull())
    .addColumn("required", t.integer, (col) => col.notNull())
    .addColumn("exception_reason", t.text)
    .addColumn("review_at", t.key(40))
    .addColumn("approved_by", t.key(200), (col) => col.notNull())
    .addColumn("updated_at", t.key(40), (col) => col.notNull())
    .addForeignKeyConstraint("fk_binding_organization", ["organization_id"], "organizations", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    .addForeignKeyConstraint("fk_binding_project", ["project_id"], "projects", ["id"], (fk) => fk.onDelete("cascade"))
    .addForeignKeyConstraint("fk_binding_team", ["team_id"], "teams", ["id"], (fk) => fk.onDelete("cascade"))
    .addCheckConstraint(
      "ck_binding_target",
      sql`(case when organization_id is null then 0 else 1 end
           + case when project_id is null then 0 else 1 end
           + case when team_id is null then 0 else 1 end) = 1`,
    )
    .execute();
  for (const scope of ["organization", "project", "team"])
    await db.schema.createIndex(`idx_binding_${scope}`).on("capability_bindings").column(`${scope}_id`).execute();
}
