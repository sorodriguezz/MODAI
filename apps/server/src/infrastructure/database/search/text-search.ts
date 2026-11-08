import { type Expression, type ExpressionBuilder, type SqlBool, sql } from "kysely";
import type { PackageVisibilityFilter } from "../../../modules/auth/namespace-access.js";
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
  personal: number;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewAt: string | null;
  approval: number;
  rank: number;
}

export interface MemoryScope {
  projectId: string;
  sessionId?: string;
  organizationId?: string;
  personalOwnerId?: string;
  sessionOwners?: string[];
  includeProject?: boolean;
  now?: string;
}

export interface KnowledgeQuery {
  terms: string[];
  packageNames: string[];
  limit: number;
  visible?: PackageVisibilityFilter;
}

export interface KnowledgeSearch {
  searchKnowledge(db: Executor, query: KnowledgeQuery): Promise<KnowledgeHit[]>;
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
  "memories.personal",
  "memories.approval",
  "memories.created_by as createdBy",
  "memories.reviewed_by as reviewedBy",
  "memories.review_at as reviewAt",
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
  const project = eb(column("project_id"), "=", scope.projectId);
  const scopeProject = eb(column("scope"), "=", "project");
  const clauses: Array<Expression<SqlBool>> = [];
  if (scope.includeProject !== false) clauses.push(eb.and([project, scopeProject, eb(column("personal"), "=", 0)]));
  if (scope.personalOwnerId)
    clauses.push(
      eb.and([
        project,
        scopeProject,
        eb(column("personal"), "=", 1),
        eb(column("created_by"), "=", scope.personalOwnerId),
      ]),
    );
  if (scope.sessionId && scope.sessionOwners?.length)
    clauses.push(
      eb.and([
        project,
        eb(column("scope"), "=", "session"),
        eb(column("session_id"), "=", scope.sessionId),
        eb(column("created_by"), "in", scope.sessionOwners),
      ]),
    );
  if (scope.organizationId)
    clauses.push(
      eb.and([
        eb(column("organization_id"), "=", scope.organizationId),
        eb(column("scope"), "=", "organization"),
        eb(column("approval"), "=", 1),
        eb.or([
          eb(column("review_at"), "is", null),
          eb(column("review_at"), ">", scope.now ?? new Date().toISOString()),
        ]),
      ]),
    );
  return eb.or(clauses);
}
