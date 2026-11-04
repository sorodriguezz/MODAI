import { type Insertable, sql, type Updateable } from "kysely";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import type { OrganizationsTable } from "../../infrastructure/database/schema.js";
import { removeGrant } from "../auth/grants.repository.js";

const tally = (values: Array<string | null>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

export class OrganizationsRepository {
  constructor(private readonly context: DataContext) {}

  list() {
    return this.context.db
      .selectFrom("organizations")
      .select(["id", "name", "description", "created_at", "updated_at"])
      .orderBy(sql`lower(${sql.ref("name")})`)
      .execute();
  }

  async projectCounts(): Promise<Map<string, number>> {
    const rows = await this.context.db.selectFrom("projects").select("organization_id").execute();
    return tally(rows.map((row) => row.organization_id));
  }

  async namespaceCounts(): Promise<Map<string, number>> {
    const rows = await this.context.db.selectFrom("namespaces").select("organization_id").execute();
    return tally(rows.map((row) => row.organization_id));
  }

  async memberCounts(): Promise<Map<string, number>> {
    const users = await this.context.db
      .selectFrom("users")
      .select("organization_ids_json as grants")
      .where("disabled_at", "is", null)
      .execute();
    const keys = await this.context.db
      .selectFrom("api_keys")
      .select("organization_ids_json as grants")
      .where("revoked_at", "is", null)
      .execute();
    return tally([...users, ...keys].flatMap((row) => JSON.parse(row.grants) as string[]));
  }

  async exists(id: string): Promise<boolean> {
    return Boolean(
      await this.context.db.selectFrom("organizations").select("id").where("id", "=", id).executeTakeFirst(),
    );
  }

  async nameTaken(name: string): Promise<boolean> {
    const row = await this.context.db
      .selectFrom("organizations")
      .select("id")
      .where(sql<boolean>`lower(${sql.ref("name")}) = lower(${name})`)
      .executeTakeFirst();
    return Boolean(row);
  }

  async insert(row: Insertable<OrganizationsTable>): Promise<void> {
    await this.context.db.insertInto("organizations").values(row).execute();
  }

  async update(id: string, fields: Updateable<OrganizationsTable>): Promise<void> {
    await this.context.db.updateTable("organizations").set(fields).where("id", "=", id).execute();
  }

  async delete(id: string): Promise<void> {
    await withTransaction(this.context, async (trx) => {
      await removeGrant(trx, "organization_ids_json", id);
      await trx.db.updateTable("memories").set({ organization_id: null }).where("organization_id", "=", id).execute();
      await trx.db.deleteFrom("organizations").where("id", "=", id).execute();
    });
  }
}
