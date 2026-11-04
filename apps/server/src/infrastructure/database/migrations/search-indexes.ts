import { type Kysely, sql } from "kysely";
import type { DialectName } from "../database-url.js";

const KNOWLEDGE_ROW = `new.id, new.package_name, new.title, new.content,
  (SELECT coalesce(group_concat(value, ' '), '') FROM json_each(new.tags_json))`;
const MEMORY_ROW = "new.id, new.project_id, new.scope, new.kind, new.content";

const SQLITE_STATEMENTS = [
  `CREATE VIRTUAL TABLE knowledge_fts USING fts5(
    id UNINDEXED, package_name UNINDEXED, title, content, tags, tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER knowledge_fts_insert AFTER INSERT ON knowledge_documents BEGIN
    INSERT INTO knowledge_fts (id, package_name, title, content, tags) VALUES (${KNOWLEDGE_ROW}); END`,
  `CREATE TRIGGER knowledge_fts_update AFTER UPDATE ON knowledge_documents BEGIN
    DELETE FROM knowledge_fts WHERE id = old.id;
    INSERT INTO knowledge_fts (id, package_name, title, content, tags) VALUES (${KNOWLEDGE_ROW}); END`,
  `CREATE TRIGGER knowledge_fts_delete AFTER DELETE ON knowledge_documents BEGIN
    DELETE FROM knowledge_fts WHERE id = old.id; END`,
  `CREATE VIRTUAL TABLE memories_fts USING fts5(
    id UNINDEXED, project_id UNINDEXED, scope UNINDEXED, kind, content, tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts (id, project_id, scope, kind, content) VALUES (${MEMORY_ROW}); END`,
  `CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
    DELETE FROM memories_fts WHERE id = old.id;
    INSERT INTO memories_fts (id, project_id, scope, kind, content) VALUES (${MEMORY_ROW}); END`,
  `CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
    DELETE FROM memories_fts WHERE id = old.id; END`,
];

const vector = (column: string, weight: string, limit = "") =>
  `setweight(to_tsvector('simple', ${limit ? `left(coalesce(${column}, ''), ${limit})` : `coalesce(${column}, '')`}), '${weight}')`;

const POSTGRES_STATEMENTS = [
  `ALTER TABLE knowledge_documents ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    ${vector("title", "A")} || ${vector("content", "B", "500000")} || ${vector("tags_json", "C")}) STORED`,
  "CREATE INDEX idx_knowledge_search ON knowledge_documents USING GIN (search_vector)",
  `ALTER TABLE memories ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
    ${vector("content", "A", "500000")} || ${vector("kind", "B")}) STORED`,
  "CREATE INDEX idx_memories_search ON memories USING GIN (search_vector)",
];

export async function createSearchIndexes(db: Kysely<unknown>, dialect: DialectName): Promise<void> {
  const statements =
    dialect === "sqlite" ? SQLITE_STATEMENTS : dialect === "postgres" ? POSTGRES_STATEMENTS : ([] as string[]);
  for (const statement of statements) await sql.raw(statement).execute(db);
}
