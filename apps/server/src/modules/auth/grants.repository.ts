import { sql } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import { escapeLike } from "../../infrastructure/database/sql-helpers.js";

export type GrantColumn = "project_ids_json" | "organization_ids_json" | "package_scopes_json";

async function removeFromTable(
  context: DataContext,
  table: "users" | "api_keys",
  column: GrantColumn,
  value: string,
): Promise<void> {
  const pattern = `%${escapeLike(JSON.stringify(value))}%`;
  const rows = await context.db
    .selectFrom(table)
    .select(["id", sql<string>`${sql.ref(column)}`.as("grants")])
    .where(sql<boolean>`${sql.ref(column)} like ${pattern} escape '!'`)
    .execute();
  for (const row of rows) {
    const grants = JSON.parse(row.grants) as string[];
    if (!grants.includes(value)) continue;
    await context.db
      .updateTable(table)
      .set({ [column]: JSON.stringify(grants.filter((item) => item !== value)) })
      .where("id", "=", row.id)
      .execute();
  }
}

export async function removeGrant(context: DataContext, column: GrantColumn, value: string): Promise<void> {
  await removeFromTable(context, "api_keys", column, value);
  await removeFromTable(context, "users", column, value);
}
