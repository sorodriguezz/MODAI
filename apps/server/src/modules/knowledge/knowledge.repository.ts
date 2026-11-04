import type { Insertable, Updateable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { KnowledgeDocumentsTable } from "../../infrastructure/database/schema.js";
import { limitRows } from "../../infrastructure/database/sql-helpers.js";
import { upsert } from "../../infrastructure/database/upsert.js";

export class KnowledgeRepository {
  constructor(private readonly context: DataContext) {}

  async insert(row: Insertable<KnowledgeDocumentsTable>): Promise<void> {
    await this.context.db.insertInto("knowledge_documents").values(row).execute();
  }

  list(limit: number, offset: number) {
    const query = this.context.db
      .selectFrom("knowledge_documents")
      .select([
        "id",
        "package_name as packageName",
        "package_version as packageVersion",
        "title",
        "content",
        "tags_json as tagsJson",
        "created_at as createdAt",
        "updated_at as updatedAt",
      ])
      .orderBy("updated_at", "desc")
      .orderBy("id");
    return limitRows(query, this.context.dialect, limit, offset).execute();
  }

  find(id: string) {
    return this.context.db
      .selectFrom("knowledge_documents")
      .select(["id", "package_name", "package_version", "title", "content", "tags_json"])
      .where("id", "=", id)
      .executeTakeFirst();
  }

  async update(id: string, fields: Updateable<KnowledgeDocumentsTable>): Promise<void> {
    await this.context.db.updateTable("knowledge_documents").set(fields).where("id", "=", id).execute();
    await this.context.db.deleteFrom("knowledge_vectors").where("document_id", "=", id).execute();
  }

  async delete(id: string): Promise<void> {
    await this.context.db.deleteFrom("knowledge_documents").where("id", "=", id).execute();
  }

  exportManual() {
    return this.context.db
      .selectFrom("knowledge_documents")
      .select(["package_name as packageName", "title", "content", "tags_json as tagsJson"])
      .where("package_version", "is", null)
      .execute();
  }

  async saveVector(documentId: string, model: string, dimensions: number, blob: Buffer): Promise<void> {
    const updatedAt = new Date().toISOString();
    await upsert(
      this.context,
      "knowledge_vectors",
      { document_id: documentId, model, dimensions, embedding_blob: blob, updated_at: updatedAt },
      ["document_id", "model"],
      { dimensions, embedding_blob: blob, updated_at: updatedAt },
    );
  }

  vectorCandidates(model: string, dimensions: number, packageNames: string[] | undefined, limit: number) {
    let query = this.context.db
      .selectFrom("knowledge_vectors as v")
      .innerJoin("knowledge_documents as k", "k.id", "v.document_id")
      .select(["v.document_id as id", "v.embedding_blob as vector"])
      .where("v.model", "=", model)
      .where("v.dimensions", "=", dimensions);
    if (packageNames?.length) query = query.where("k.package_name", "in", packageNames);
    return limitRows(query, this.context.dialect, limit).execute();
  }

  document(id: string) {
    return this.context.db
      .selectFrom("knowledge_documents")
      .select([
        "id",
        "package_name as packageName",
        "package_version as packageVersion",
        "title",
        "content",
        "tags_json as tagsJson",
      ])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
  }
}
