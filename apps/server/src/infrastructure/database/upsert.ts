import { type Kysely, sql } from "kysely";
import { type DataContext, withTransaction } from "./database.js";
import type { Schema } from "./schema.js";

type Row = Record<string, unknown>;
type LooseDatabase = Kysely<Record<string, Row>>;

const loose = (context: DataContext): LooseDatabase => context.db as unknown as LooseDatabase;

function matching(db: LooseDatabase, table: string, values: Row, keys: string[]) {
  return db
    .selectFrom(table)
    .select(sql`1`.as("found"))
    .where((eb) => eb.and(keys.map((key) => eb(sql.ref(key), "=", values[key]))));
}

export async function insertIgnore(
  context: DataContext,
  table: keyof Schema & string,
  values: Row,
  keys: string[],
): Promise<void> {
  const db = loose(context);
  if (context.dialect === "sqlite" || context.dialect === "postgres") {
    await db
      .insertInto(table)
      .values(values)
      .onConflict((conflict) => conflict.columns(keys).doNothing())
      .execute();
    return;
  }
  if (context.dialect === "mysql") {
    await db.insertInto(table).ignore().values(values).execute();
    return;
  }
  await withTransaction(context, async (trx) => {
    const exists = await matching(loose(trx), table, values, keys).executeTakeFirst();
    if (!exists) await loose(trx).insertInto(table).values(values).execute();
  });
}

export async function upsert(
  context: DataContext,
  table: keyof Schema & string,
  values: Row,
  keys: string[],
  update: Row,
): Promise<void> {
  const db = loose(context);
  if (context.dialect === "sqlite" || context.dialect === "postgres") {
    await db
      .insertInto(table)
      .values(values)
      .onConflict((conflict) => conflict.columns(keys).doUpdateSet(update))
      .execute();
    return;
  }
  if (context.dialect === "mysql") {
    await db.insertInto(table).values(values).onDuplicateKeyUpdate(update).execute();
    return;
  }
  await withTransaction(context, async (trx) => {
    const updated = await loose(trx)
      .updateTable(table)
      .set(update)
      .where((eb) => eb.and(keys.map((key) => eb(sql.ref(key), "=", values[key]))))
      .executeTakeFirst();
    if (!Number(updated.numUpdatedRows)) await loose(trx).insertInto(table).values(values).execute();
  });
}
