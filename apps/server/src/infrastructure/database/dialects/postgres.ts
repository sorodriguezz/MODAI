import { type Dialect, PostgresDialect } from "kysely";
import { loadDriver } from "./load-driver.js";

export async function postgresDialect(url: string): Promise<Dialect> {
  const { default: pg } = await loadDriver(() => import("pg"), "pg", "PostgreSQL");
  return new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 10 }) });
}
