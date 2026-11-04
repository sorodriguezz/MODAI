import { type Expression, sql } from "kysely";
import type { DialectName } from "../database-url.js";

type ColumnType = "text" | "integer" | "blob" | Expression<unknown>;

export interface ColumnTypes {
  text: ColumnType;
  key: (length: number) => ColumnType;
  integer: ColumnType;
  blob: ColumnType;
}

// why: every engine compares and sorts text byte-wise like SQLite, so lookups and ordering stay identical.
const COLLATION: Record<Exclude<DialectName, "sqlite">, string> = {
  postgres: 'collate "C"',
  mysql: "collate utf8mb4_bin",
  mssql: "collate Latin1_General_100_BIN2_UTF8",
};

export function columnTypes(dialect: DialectName): ColumnTypes {
  if (dialect === "sqlite") return { text: "text", key: () => "text", integer: "integer", blob: "blob" };
  const collation = COLLATION[dialect];
  if (dialect === "postgres") {
    const text = sql.raw(`text ${collation}`);
    return { text, key: () => text, integer: "integer", blob: sql.raw("bytea") };
  }
  if (dialect === "mysql")
    return {
      text: sql.raw(`longtext ${collation}`),
      key: (length) => sql.raw(`varchar(${length}) ${collation}`),
      integer: "integer",
      blob: sql.raw("longblob"),
    };
  return {
    text: sql.raw(`varchar(max) ${collation}`),
    key: (length) => sql.raw(`varchar(${length}) ${collation}`),
    integer: "integer",
    blob: sql.raw("varbinary(max)"),
  };
}
