import type { Insertable, Selectable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { SessionsTable } from "../../infrastructure/database/schema.js";
import type { UserRow } from "./users.repository.js";

export type SessionUserRow = UserRow &
  Pick<Selectable<SessionsTable>, "expires_at" | "absolute_expires_at" | "last_seen_at">;

export class SessionsRepository {
  constructor(private readonly context: DataContext) {}

  async deleteExpired(now: string): Promise<void> {
    await this.context.db
      .deleteFrom("sessions")
      .where((eb) => eb.or([eb("expires_at", "<", now), eb("absolute_expires_at", "<", now)]))
      .execute();
  }

  async insert(row: Insertable<SessionsTable>): Promise<void> {
    await this.context.db.insertInto("sessions").values(row).execute();
  }

  findWithUser(tokenHash: string): Promise<SessionUserRow | undefined> {
    return this.context.db
      .selectFrom("sessions")
      .innerJoin("users", "users.id", "sessions.user_id")
      .selectAll("users")
      .select(["sessions.expires_at", "sessions.absolute_expires_at", "sessions.last_seen_at"])
      .where("sessions.token_hash", "=", tokenHash)
      .executeTakeFirst();
  }

  async touch(tokenHash: string, lastSeenAt: string, expiresAt: string): Promise<void> {
    await this.context.db
      .updateTable("sessions")
      .set({ last_seen_at: lastSeenAt, expires_at: expiresAt })
      .where("token_hash", "=", tokenHash)
      .execute();
  }

  async delete(tokenHash: string): Promise<void> {
    await this.context.db.deleteFrom("sessions").where("token_hash", "=", tokenHash).execute();
  }

  async deleteForUser(userId: string, exceptTokenHash?: string): Promise<void> {
    let query = this.context.db.deleteFrom("sessions").where("user_id", "=", userId);
    if (exceptTokenHash !== undefined) query = query.where("token_hash", "!=", exceptTokenHash);
    await query.execute();
  }
}
