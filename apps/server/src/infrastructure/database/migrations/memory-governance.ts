import type { Kysely } from "kysely";
import type { ColumnTypes } from "./column-types.js";

export async function addMemoryGovernance(db: Kysely<unknown>, t: ColumnTypes): Promise<void> {
  await db.schema
    .alterTable("memories")
    .addColumn("personal", t.integer, (col) => col.notNull().defaultTo(0))
    .execute();
  await db.schema
    .alterTable("memories")
    .addColumn("approval", t.integer, (col) => col.notNull().defaultTo(1))
    .execute();
  await db.schema.alterTable("memories").addColumn("reviewed_by", t.key(200)).execute();
  await db.schema.alterTable("memories").addColumn("review_at", t.key(40)).execute();
  await db.schema
    .createIndex("idx_memories_org_review")
    .on("memories")
    .columns(["organization_id", "scope", "approval"])
    .execute();
  await db.schema
    .createIndex("idx_memories_private")
    .on("memories")
    .columns(["project_id", "created_by", "scope", "session_id"])
    .execute();
}
