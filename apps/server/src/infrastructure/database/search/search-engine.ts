import type { DialectName } from "../database-url.js";
import { LikeTextSearch } from "./like-search.js";
import { PostgresTextSearch } from "./postgres-search.js";
import { SqliteFtsSearch } from "./sqlite-search.js";
import type { TextSearch } from "./text-search.js";

export function textSearchFor(dialect: DialectName): TextSearch {
  if (dialect === "sqlite") return new SqliteFtsSearch();
  if (dialect === "postgres") return new PostgresTextSearch();
  return new LikeTextSearch(dialect);
}
