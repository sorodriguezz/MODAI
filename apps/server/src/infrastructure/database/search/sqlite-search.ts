import { sql } from "kysely";
import type { Executor } from "../database.js";
import {
  KNOWLEDGE_COLUMNS,
  type KnowledgeHit,
  MEMORY_COLUMNS,
  type MemoryHit,
  type MemoryScope,
  memoryScopeFilter,
  type TextSearch,
} from "./text-search.js";

const matchQuery = (terms: string[]): string => terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" OR ");

export class SqliteFtsSearch implements TextSearch {
  async searchKnowledge(
    db: Executor,
    query: { terms: string[]; packageNames: string[]; limit: number },
  ): Promise<KnowledgeHit[]> {
    let select = db
      .selectFrom("knowledge_fts")
      .innerJoin("knowledge_documents", "knowledge_documents.id", "knowledge_fts.id")
      .select(KNOWLEDGE_COLUMNS)
      .select(sql<number>`bm25(knowledge_fts, 0, 0, 4, 1, 0.5)`.as("rank"))
      .where(sql<boolean>`knowledge_fts MATCH ${matchQuery(query.terms)}`);
    if (query.packageNames.length) select = select.where("knowledge_documents.package_name", "in", query.packageNames);
    return select.orderBy("rank").limit(query.limit).execute();
  }

  async searchMemories(
    db: Executor,
    query: { terms: string[]; scope: MemoryScope; limit: number },
  ): Promise<MemoryHit[]> {
    return db
      .selectFrom("memories_fts")
      .innerJoin("memories", "memories.id", "memories_fts.id")
      .select(MEMORY_COLUMNS)
      .select(sql<number>`bm25(memories_fts, 0, 0, 0, 1, 2)`.as("rank"))
      .where(sql<boolean>`memories_fts MATCH ${matchQuery(query.terms)}`)
      .where((eb) => memoryScopeFilter(eb, query.scope))
      .orderBy("rank")
      .limit(query.limit)
      .execute();
  }
}
