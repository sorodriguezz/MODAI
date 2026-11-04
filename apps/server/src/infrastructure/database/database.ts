import { type Dialect, Kysely } from "kysely";
import type { DatabaseConfig, DialectName } from "./database-url.js";
import { mssqlDialect } from "./dialects/mssql.js";
import { mysqlDialect } from "./dialects/mysql.js";
import { postgresDialect } from "./dialects/postgres.js";
import { sqliteDialect } from "./dialects/sqlite.js";
import { migrateToLatest } from "./migrations/migrator.js";
import type { Schema } from "./schema.js";

export type Executor = Kysely<Schema>;

export interface DataContext {
  readonly db: Executor;
  readonly dialect: DialectName;
}

export interface Database extends DataContext {
  transaction<T>(work: (context: DataContext) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function createDialect(config: DatabaseConfig): Promise<Dialect> {
  if (config.dialect === "sqlite") return sqliteDialect(config.path);
  if (config.dialect === "postgres") return postgresDialect(config.url);
  if (config.dialect === "mysql") return mysqlDialect(config.url);
  return mssqlDialect(config.url);
}

export async function connectDatabase(config: DatabaseConfig): Promise<Kysely<Schema>> {
  return new Kysely<Schema>({ dialect: await createDialect(config) });
}

export function withTransaction<T>(context: DataContext, work: (context: DataContext) => Promise<T>): Promise<T> {
  if (context.db.isTransaction) return work(context);
  return context.db.transaction().execute((trx) => work({ db: trx, dialect: context.dialect }));
}

export async function openDatabase(config: DatabaseConfig): Promise<Database> {
  const db = await connectDatabase(config);
  try {
    await migrateToLatest(db, config.dialect);
  } catch (error) {
    await db.destroy();
    throw error;
  }
  const context: DataContext = { db, dialect: config.dialect };
  return {
    ...context,
    transaction: (work) => withTransaction(context, work),
    close: () => db.destroy(),
  };
}
