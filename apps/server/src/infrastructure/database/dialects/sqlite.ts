import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Dialect, SqliteDialect } from "kysely";
import { loadDriver } from "./load-driver.js";

export async function sqliteDialect(path: string): Promise<Dialect> {
  const { default: BetterSqlite3 } = await loadDriver(() => import("better-sqlite3"), "better-sqlite3", "SQLite");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new BetterSqlite3(path);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  return new SqliteDialect({ database });
}
