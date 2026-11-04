import type { DataContext } from "../../infrastructure/database/database.js";
import { affectedRows } from "../../infrastructure/database/sql-helpers.js";
import { upsert } from "../../infrastructure/database/upsert.js";

export class PublishersRepository {
  constructor(private readonly context: DataContext) {}

  find(fingerprint: string) {
    return this.context.db
      .selectFrom("publishers")
      .select(["public_key", "trusted"])
      .where("fingerprint", "=", fingerprint)
      .executeTakeFirst();
  }

  async register(fingerprint: string, publicKey: string, label: string | null, trusted: boolean): Promise<void> {
    const values = { fingerprint, label, public_key: publicKey, trusted: trusted ? 1 : 0 };
    await upsert(this.context, "publishers", { ...values, created_at: new Date().toISOString() }, ["fingerprint"], {
      label,
      trusted: values.trusted,
    });
  }

  async ensureKey(fingerprint: string, publicKey: string, now: string): Promise<void> {
    await upsert(
      this.context,
      "publishers",
      { fingerprint, label: null, public_key: publicKey, trusted: 0, created_at: now },
      ["fingerprint"],
      { public_key: publicKey },
    );
  }

  async restore(fingerprint: string, publicKey: string, label: string | null, trusted: boolean): Promise<void> {
    const values = { label, public_key: publicKey, trusted: trusted ? 1 : 0 };
    await upsert(
      this.context,
      "publishers",
      { fingerprint, ...values, created_at: new Date().toISOString() },
      ["fingerprint"],
      values,
    );
  }

  list() {
    return this.context.db
      .selectFrom("publishers")
      .select(["fingerprint", "label", "trusted", "created_at as createdAt"])
      .orderBy("created_at", "desc")
      .execute();
  }

  exportAll() {
    return this.context.db
      .selectFrom("publishers")
      .select(["fingerprint", "label", "public_key as publicKey", "trusted"])
      .execute();
  }

  async trust(fingerprint: string, trusted: boolean, label?: string): Promise<number> {
    const result = await this.context.db
      .updateTable("publishers")
      .set(label === undefined ? { trusted: trusted ? 1 : 0 } : { trusted: trusted ? 1 : 0, label })
      .where("fingerprint", "=", fingerprint)
      .executeTakeFirst();
    return affectedRows(result);
  }
}
