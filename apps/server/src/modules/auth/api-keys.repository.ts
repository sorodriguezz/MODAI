import type { Insertable, Selectable, Updateable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { ApiKeysTable } from "../../infrastructure/database/schema.js";
import { affectedRows } from "../../infrastructure/database/sql-helpers.js";
import type { KeyRecord, Role } from "./identity.js";

export type ApiKeyRow = Selectable<ApiKeysTable>;

const KEY_COLUMNS = [
  "k.id",
  "k.label",
  "k.role",
  "k.created_at as createdAt",
  "k.last_used_at as lastUsedAt",
  "k.revoked_at as revokedAt",
  "k.project_ids_json as projects",
  "k.organization_ids_json as organizations",
  "k.package_scopes_json as scopes",
  "k.owner_user_id as ownerId",
  "u.username as ownerName",
  "k.inherit_grants as inherit",
] as const;

interface KeyListRow {
  id: string;
  label: string;
  role: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  projects: string;
  organizations: string;
  scopes: string;
  ownerId: string | null;
  ownerName: string | null;
  inherit: number;
}

export const toKey = (row: KeyListRow): KeyRecord => ({
  id: row.id,
  label: row.label,
  role: row.role as Role,
  createdAt: row.createdAt,
  ...(row.lastUsedAt ? { lastUsedAt: row.lastUsedAt } : {}),
  ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  ...(row.ownerId ? { ownerId: row.ownerId, ownerName: row.ownerName ?? "(eliminado)" } : {}),
  inherit: Boolean(row.inherit),
  projectIds: JSON.parse(row.projects),
  organizationIds: JSON.parse(row.organizations),
  packageScopes: JSON.parse(row.scopes),
});

export class ApiKeysRepository {
  constructor(private readonly context: DataContext) {}

  findActiveByTokenHash(tokenHash: string): Promise<ApiKeyRow | undefined> {
    return this.context.db
      .selectFrom("api_keys")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
  }

  async touch(id: string, at: string): Promise<void> {
    await this.context.db.updateTable("api_keys").set({ last_used_at: at }).where("id", "=", id).execute();
  }

  async hasActiveAdmin(): Promise<boolean> {
    const row = await this.context.db
      .selectFrom("api_keys")
      .select("id")
      .where("role", "=", "admin")
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return Boolean(row);
  }

  async insert(row: Insertable<ApiKeysTable>): Promise<void> {
    await this.context.db.insertInto("api_keys").values(row).execute();
  }

  async updateActive(id: string, fields: Updateable<ApiKeysTable>): Promise<number> {
    const result = await this.context.db
      .updateTable("api_keys")
      .set(fields)
      .where("id", "=", id)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return affectedRows(result);
  }

  private keys() {
    return this.context.db
      .selectFrom("api_keys as k")
      .leftJoin("users as u", "u.id", "k.owner_user_id")
      .select(KEY_COLUMNS);
  }

  async get(id: string): Promise<KeyRecord | undefined> {
    const row = await this.keys().where("k.id", "=", id).executeTakeFirst();
    return row ? toKey(row) : undefined;
  }

  async list(ownerId?: string): Promise<KeyRecord[]> {
    let query = this.keys();
    if (ownerId) query = query.where("k.owner_user_id", "=", ownerId);
    return (await query.orderBy("k.created_at", "desc").execute()).map(toKey);
  }
}
