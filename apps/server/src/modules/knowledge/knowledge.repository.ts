import type { Insertable, Updateable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { KnowledgeDocumentsTable } from "../../infrastructure/database/schema.js";
import { limitRows } from "../../infrastructure/database/sql-helpers.js";
import { upsert } from "../../infrastructure/database/upsert.js";
import type { PackageVisibilityFilter } from "../auth/namespace-access.js";
import { catalogKnowledge, projectKnowledge } from "./knowledge-scope.js";

const DOCUMENT_COLUMNS = [
  "id",
  "project_id as projectId",
  "package_name as packageName",
  "package_version as packageVersion",
  "title",
  "content",
  "tags_json as tagsJson",
  "created_at as createdAt",
  "updated_at as updatedAt",
] as const;

export class KnowledgeRepository {
  constructor(private readonly context: DataContext) {}

  async insert(row: Insertable<KnowledgeDocumentsTable>): Promise<void> {
    await this.context.db.insertInto("knowledge_documents").values(row).execute();
  }

  list(limit: number, offset: number, visible?: PackageVisibilityFilter) {
    let query = this.context.db
      .selectFrom("knowledge_documents")
      .select(DOCUMENT_COLUMNS)
      .orderBy("updated_at", "desc")
      .orderBy("id");
    if (visible) query = query.where(visible(this.context.db, "knowledge_documents.package_name"));
    return limitRows(query, this.context.dialect, limit, offset).execute();
  }

  find(id: string, projectId?: string) {
    const scope = projectId ? projectKnowledge(projectId) : catalogKnowledge();
    return this.context.db
      .selectFrom("knowledge_documents")
      .select(["id", "project_id", "package_name", "package_version", "title", "content", "tags_json"])
      .where("id", "=", id)
      .where(scope(this.context.db, "knowledge_documents.package_name"))
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
      .select(["project_id as projectId", "package_name as packageName", "title", "content", "tags_json as tagsJson"])
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

  vectorCandidates(
    model: string,
    dimensions: number,
    packageNames: string[] | undefined,
    limit: number,
    visible?: PackageVisibilityFilter,
  ) {
    let query = this.context.db
      .selectFrom("knowledge_vectors as v")
      .innerJoin("knowledge_documents", "knowledge_documents.id", "v.document_id")
      .select(["v.document_id as id", "v.embedding_blob as vector"])
      .where("v.model", "=", model)
      .where("v.dimensions", "=", dimensions);
    if (packageNames?.length) query = query.where("knowledge_documents.package_name", "in", packageNames);
    if (visible) query = query.where(visible(this.context.db, "knowledge_documents.package_name"));
    return limitRows(query, this.context.dialect, limit).execute();
  }

  document(id: string, visible?: PackageVisibilityFilter) {
    let query = this.context.db.selectFrom("knowledge_documents").select(DOCUMENT_COLUMNS).where("id", "=", id);
    if (visible) query = query.where(visible(this.context.db, "knowledge_documents.package_name"));
    return query.executeTakeFirst();
  }
}
