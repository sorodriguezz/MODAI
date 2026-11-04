import { type Kysely, sql } from "kysely";
import type { ColumnTypes } from "./column-types.js";

export async function createKnowledgeTables(db: Kysely<unknown>, t: ColumnTypes): Promise<void> {
  await db.schema
    .createTable("knowledge_documents")
    .addColumn("id", t.key(100), (col) => col.primaryKey())
    .addColumn("package_name", t.key(214))
    .addColumn("package_version", t.key(100))
    .addColumn("title", t.text, (col) => col.notNull())
    .addColumn("content", t.text, (col) => col.notNull())
    .addColumn("tags_json", t.text, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("updated_at", t.key(40), (col) => col.notNull())
    .execute();
  await db.schema
    .createTable("knowledge_vectors")
    .addColumn("document_id", t.key(100), (col) => col.notNull())
    .addColumn("model", t.key(200), (col) => col.notNull())
    .addColumn("dimensions", t.integer, (col) => col.notNull())
    .addColumn("embedding_blob", t.blob, (col) => col.notNull())
    .addColumn("updated_at", t.key(40), (col) => col.notNull())
    .addPrimaryKeyConstraint("pk_knowledge_vectors", ["document_id", "model"])
    .addForeignKeyConstraint("fk_vectors_document", ["document_id"], "knowledge_documents", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    .execute();
  await db.schema.createIndex("idx_vector_space").on("knowledge_vectors").columns(["model", "dimensions"]).execute();
}

export async function createMemoryTables(db: Kysely<unknown>, t: ColumnTypes): Promise<void> {
  await db.schema
    .createTable("memories")
    .addColumn("id", t.key(100), (col) => col.primaryKey())
    .addColumn("project_id", t.key(200), (col) => col.notNull())
    .addColumn("organization_id", t.key(200))
    .addColumn("session_id", t.key(200))
    .addColumn("created_by", t.key(200))
    .addColumn("scope", t.key(20), (col) => col.notNull())
    .addColumn("kind", t.key(100), (col) => col.notNull())
    .addColumn("content", t.text, (col) => col.notNull())
    .addColumn("metadata_json", t.text, (col) => col.notNull())
    .addColumn("created_at", t.key(40), (col) => col.notNull())
    .addColumn("updated_at", t.key(40), (col) => col.notNull())
    .addCheckConstraint("ck_memories_scope", sql`scope in ('project', 'organization', 'session')`)
    .execute();
  await db.schema
    .createIndex("idx_memories_project")
    .on("memories")
    .columns(["project_id", "updated_at desc"])
    .execute();
}
