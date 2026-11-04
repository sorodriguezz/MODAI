import { type RawBuilder, sql } from "kysely";
import type { Executor } from "../database.js";
import type { DialectName } from "../database-url.js";
import { escapeLike, likeLower, limitRows } from "../sql-helpers.js";
import {
  KNOWLEDGE_COLUMNS,
  type KnowledgeHit,
  MEMORY_COLUMNS,
  type MemoryHit,
  type MemoryScope,
  memoryScopeFilter,
  type TextSearch,
} from "./text-search.js";

type Weighted = Array<[column: string, weight: number]>;

const KNOWLEDGE_WEIGHTS: Weighted = [
  ["knowledge_documents.title", 8],
  ["knowledge_documents.content", 2],
  ["knowledge_documents.tags_json", 1],
];
const MEMORY_WEIGHTS: Weighted = [
  ["memories.content", 2],
  ["memories.kind", 1],
];

function matches(columns: Weighted, terms: string[]): Array<{ condition: RawBuilder<boolean>; weight: number }> {
  return terms.flatMap((term) =>
    columns.map(([column, weight]) => ({ condition: likeLower(column, `%${escapeLike(term)}%`), weight })),
  );
}

function rank(columns: Weighted, terms: string[]): RawBuilder<number> {
  const parts = matches(columns, terms).map(
    ({ condition, weight }) => sql`case when ${condition} then ${sql.lit(weight)} else 0 end`,
  );
  return sql<number>`-(${sql.join(parts, sql` + `)})`;
}

function anyMatch(columns: Weighted, terms: string[]): RawBuilder<boolean> {
  return sql<boolean>`(${sql.join(
    matches(columns, terms).map(({ condition }) => condition),
    sql` or `,
  )})`;
}

export class LikeTextSearch implements TextSearch {
  constructor(private readonly dialect: DialectName) {}

  async searchKnowledge(
    db: Executor,
    query: { terms: string[]; packageNames: string[]; limit: number },
  ): Promise<KnowledgeHit[]> {
    let select = db
      .selectFrom("knowledge_documents")
      .select(KNOWLEDGE_COLUMNS)
      .select(rank(KNOWLEDGE_WEIGHTS, query.terms).as("rank"))
      .where(anyMatch(KNOWLEDGE_WEIGHTS, query.terms));
    if (query.packageNames.length) select = select.where("knowledge_documents.package_name", "in", query.packageNames);
    const ordered = select.orderBy("rank").orderBy("knowledge_documents.id");
    return limitRows(ordered, this.dialect, query.limit).execute();
  }

  async searchMemories(
    db: Executor,
    query: { terms: string[]; scope: MemoryScope; limit: number },
  ): Promise<MemoryHit[]> {
    const select = db
      .selectFrom("memories")
      .select(MEMORY_COLUMNS)
      .select(rank(MEMORY_WEIGHTS, query.terms).as("rank"))
      .where(anyMatch(MEMORY_WEIGHTS, query.terms))
      .where((eb) => memoryScopeFilter(eb, query.scope))
      .orderBy("rank")
      .orderBy("memories.id");
    return limitRows(select, this.dialect, query.limit).execute();
  }
}
