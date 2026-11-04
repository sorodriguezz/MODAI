import { resolve } from "node:path";

export type DialectName = "sqlite" | "postgres" | "mysql" | "mssql";

export type DatabaseConfig =
  | { dialect: "sqlite"; path: string }
  | { dialect: "postgres" | "mysql" | "mssql"; url: string };

const SCHEMES: Record<string, DialectName> = {
  "sqlite:": "sqlite",
  "postgres:": "postgres",
  "postgresql:": "postgres",
  "mysql:": "mysql",
  "sqlserver:": "mssql",
  "mssql:": "mssql",
};

function sqlitePath(value: string): string {
  const rest = value.slice("sqlite:".length).replace(/^\/\//, "").split("?")[0];
  const path = decodeURIComponent(rest);
  if (!path) throw new Error("MODAI_DATABASE_URL de SQLite necesita una ruta, por ejemplo sqlite:///datos/modai.db");
  return path === ":memory:" ? path : resolve(path);
}

export function parseDatabaseUrl(value: string): DatabaseConfig {
  const scheme = value.slice(0, value.indexOf(":") + 1).toLowerCase();
  const dialect = SCHEMES[scheme];
  if (!dialect)
    throw new Error(
      "MODAI_DATABASE_URL no es válida: usa sqlite:, postgres://, postgresql://, mysql://, sqlserver:// o mssql://",
    );
  if (dialect === "sqlite") return { dialect, path: sqlitePath(value) };
  try {
    new URL(value);
  } catch {
    throw new Error(`MODAI_DATABASE_URL no es una URL válida para ${dialect}`);
  }
  return { dialect, url: value };
}

export function resolveDatabaseConfig(options: { databaseUrl?: string; databasePath?: string }): DatabaseConfig {
  if (options.databaseUrl?.trim()) return parseDatabaseUrl(options.databaseUrl.trim());
  if (!options.databasePath) throw new Error("Configura MODAI_DATABASE_URL o MODAI_DATABASE_PATH");
  return { dialect: "sqlite", path: options.databasePath };
}
