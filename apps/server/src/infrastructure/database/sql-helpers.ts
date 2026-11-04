import { type RawBuilder, type SelectQueryBuilder, sql } from "kysely";
import type { DialectName } from "./database-url.js";

export const toNumber = (value: unknown): number => Number(value ?? 0);

export const affectedRows = (result: { numUpdatedRows?: bigint; numDeletedRows?: bigint } | undefined): number =>
  Number(result?.numUpdatedRows ?? result?.numDeletedRows ?? 0);

export function limitRows<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
  dialect: DialectName,
  limit: number,
  offset?: number,
): SelectQueryBuilder<DB, TB, O> {
  if (dialect !== "mssql") return offset ? query.limit(limit).offset(offset) : query.limit(limit);
  return offset ? query.offset(offset).fetch(limit) : query.top(limit);
}

export const escapeLike = (value: string): string => value.replace(/[!%_[]/g, (match) => `!${match}`);

export function likeLower(column: string, pattern: string): RawBuilder<boolean> {
  return sql<boolean>`lower(${sql.ref(column)}) like ${pattern} escape '!'`;
}

export function byteLength(dialect: DialectName, column: string): RawBuilder<number> {
  const ref = sql.ref(column);
  if (dialect === "sqlite") return sql<number>`length(cast(${ref} as blob))`;
  if (dialect === "postgres") return sql<number>`octet_length(${ref})`;
  if (dialect === "mysql") return sql<number>`length(${ref})`;
  return sql<number>`datalength(${ref})`;
}

const UNIQUE_CODES = new Set(["SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY", "23505", "ER_DUP_ENTRY"]);

export function isUniqueViolation(error: unknown): boolean {
  const value = error as { code?: unknown; number?: unknown; message?: unknown };
  return (
    UNIQUE_CODES.has(String(value?.code)) ||
    value?.number === 2627 ||
    value?.number === 2601 ||
    String(value?.message ?? "").includes("UNIQUE")
  );
}
