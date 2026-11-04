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

const tsQuery = (terms: string[]) => sql`to_tsquery('simple', ${terms.map((term) => `'${term}':*`).join(" | ")})`;

export class PostgresTextSearch implements TextSearch {
  async searchKnowledge(
    db: Executor,
    query: { terms: string[]; packageNames: string[]; limit: number },
  ): Promise<KnowledgeHit[]> {
    const match = tsQuery(query.terms);
    let select = db
      .selectFrom("knowledge_documents")
      .select(KNOWLEDGE_COLUMNS)
      .select(sql<number>`-ts_rank('{0.1,0.125,0.25,1}', knowledge_documents.search_vector, ${match})`.as("rank"))
      .where(sql<boolean>`knowledge_documents.search_vector @@ ${match}`);
    if (query.packageNames.length) select = select.where("knowledge_documents.package_name", "in", query.packageNames);
    return select.orderBy("rank").orderBy("knowledge_documents.id").limit(query.limit).execute();
  }

  async searchMemories(
    db: Executor,
    query: { terms: string[]; scope: MemoryScope; limit: number },
  ): Promise<MemoryHit[]> {
    const match = tsQuery(query.terms);
    return db
      .selectFrom("memories")
      .select(MEMORY_COLUMNS)
      .select(sql<number>`-ts_rank('{0.1,0.1,0.5,1}', memories.search_vector, ${match})`.as("rank"))
      .where(sql<boolean>`memories.search_vector @@ ${match}`)
      .where((eb) => memoryScopeFilter(eb, query.scope))
      .orderBy("rank")
      .orderBy("memories.id")
      .limit(query.limit)
      .execute();
  }
}
