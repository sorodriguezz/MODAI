import { createHash } from "node:crypto";
import { sql } from "kysely";
import { connectDatabase, type Database, openDatabase } from "../../src/infrastructure/database/database.js";
import { parseDatabaseUrl } from "../../src/infrastructure/database/database-url.js";

const serverUrl = process.env.MODAI_TEST_DATABASE_URL?.trim();
const created = new Set<string>();

function databaseName(path: string): string {
  return `modai_t_${createHash("sha1").update(path).digest("hex").slice(0, 16)}`;
}

function urlFor(name: string): string {
  const url = new URL(serverUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createDatabase(name: string): Promise<void> {
  if (created.has(name)) return;
  const config = parseDatabaseUrl(serverUrl!);
  const admin = await connectDatabase(config);
  try {
    if (config.dialect === "postgres") {
      const exists = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`.execute(admin);
      if (!exists.rows.length) await sql.raw(`CREATE DATABASE ${name}`).execute(admin);
    } else if (config.dialect === "mysql") {
      await sql.raw(`CREATE DATABASE IF NOT EXISTS ${name} CHARACTER SET utf8mb4`).execute(admin);
    } else if (config.dialect === "mssql") {
      await sql.raw(`IF DB_ID(N'${name}') IS NULL CREATE DATABASE [${name}]`).execute(admin);
    }
  } finally {
    await admin.destroy();
  }
  created.add(name);
}

export async function testDatabase(path: string): Promise<{ databasePath: string } | { databaseUrl: string }> {
  if (!serverUrl) return { databasePath: path };
  const name = databaseName(path);
  await createDatabase(name);
  return { databaseUrl: urlFor(name) };
}

export async function openTestDatabase(path: string): Promise<Database> {
  const options = await testDatabase(path);
  return openDatabase(
    "databaseUrl" in options
      ? parseDatabaseUrl(options.databaseUrl)
      : { dialect: "sqlite", path: options.databasePath },
  );
}
