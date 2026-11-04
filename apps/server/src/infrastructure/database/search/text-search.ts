import { type Expression, type ExpressionBuilder, type SqlBool, sql } from "kysely";
import type { Executor } from "../database.js";
import type { Schema } from "../schema.js";

export interface KnowledgeHit {
  id: string;
  packageName: string | null;
  packageVersion: string | null;
  title: string;
  content: string;
  tagsJson: string;
  createdAt: string;
  rank: number;
}

export interface MemoryHit {
  id: string;
  projectId: string;
  scope: string;
  kind: string;
  content: string;
  organizationId: string | null;
  sessionId: string | null;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
  rank: number;
}

export interface MemoryScope {
  projectId: string;
  sessionId?: string;
  organizationId?: string;
}

export interface KnowledgeSearch {
  searchKnowledge(
    db: Executor,
    query: { terms: string[]; packageNames: string[]; limit: number },
  ): Promise<KnowledgeHit[]>;
}

export interface MemorySearch {
  searchMemories(db: Executor, query: { terms: string[]; scope: MemoryScope; limit: number }): Promise<MemoryHit[]>;
}

export type TextSearch = KnowledgeSearch & MemorySearch;

export const KNOWLEDGE_COLUMNS = [
  "knowledge_documents.id",
  "knowledge_documents.package_name as packageName",
  "knowledge_documents.package_version as packageVersion",
  "knowledge_documents.title",
  "knowledge_documents.content",
  "knowledge_documents.tags_json as tagsJson",
  "knowledge_documents.created_at as createdAt",
] as const;

export const MEMORY_COLUMNS = [
  "memories.id",
  "memories.project_id as projectId",
  "memories.scope",
  "memories.kind",
  "memories.content",
  "memories.organization_id as organizationId",
  "memories.session_id as sessionId",
  "memories.metadata_json as metadataJson",
  "memories.created_at as createdAt",
  "memories.updated_at as updatedAt",
] as const;

export function searchTerms(input: string): string[] {
  const terms = input.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(terms)].slice(0, 12);
}

export function memoryScopeFilter<TB extends keyof Schema>(
  eb: ExpressionBuilder<Schema, TB>,
  scope: MemoryScope,
): Expression<SqlBool> {
  const column = (name: string) => sql.ref(`memories.${name}`);
  const clauses = [eb.and([eb(column("project_id"), "=", scope.projectId), eb(column("scope"), "=", "project")])];
  if (scope.sessionId)
    clauses.push(
      eb.and([
        eb(column("project_id"), "=", scope.projectId),
        eb(column("scope"), "=", "session"),
        eb(column("session_id"), "=", scope.sessionId),
      ]),
    );
  if (scope.organizationId)
    clauses.push(
      eb.and([eb(column("organization_id"), "=", scope.organizationId), eb(column("scope"), "=", "organization")]),
    );
  return eb.or(clauses);
}
