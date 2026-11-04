import { invariant } from "@modai/contracts/errors";
import type { DataContext } from "../../infrastructure/database/database.js";
import { byteLength, toNumber } from "../../infrastructure/database/sql-helpers.js";

async function storedBytes(context: DataContext, table: "knowledge_documents" | "memories"): Promise<number> {
  const row = await context.db
    .selectFrom(table)
    .select((eb) => eb.fn.sum(byteLength(context.dialect, "content")).as("n"))
    .executeTakeFirst();
  return toNumber(row?.n);
}

export async function assertContentBudget(context: DataContext, content: string): Promise<void> {
  invariant(
    typeof content === "string" && Buffer.byteLength(content) <= 250_000,
    413,
    "CONTENT_TOO_LARGE",
    "El contenido supera 250 kB",
  );
  const total = (await storedBytes(context, "knowledge_documents")) + (await storedBytes(context, "memories"));
  invariant(
    total + Buffer.byteLength(content) <= 128 * 1024 * 1024,
    413,
    "CONTEXT_QUOTA",
    "Cuota de contexto alcanzada",
  );
}
