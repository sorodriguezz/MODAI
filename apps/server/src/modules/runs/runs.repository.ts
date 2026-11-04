import type { RunRecord } from "@modai/contracts/types";
import type { Insertable, Selectable, Updateable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { RunsTable } from "../../infrastructure/database/schema.js";
import { affectedRows, limitRows, toNumber } from "../../infrastructure/database/sql-helpers.js";
import { insertIgnore } from "../../infrastructure/database/upsert.js";

export type RunRow = Selectable<RunsTable>;

export const toRun = (row: RunRow): RunRecord => ({
  id: row.id,
  projectId: row.project_id,
  agentName: row.agent_name,
  agentVersion: row.agent_version,
  task: row.task,
  bundle: JSON.parse(row.bundle_json),
  status: row.status as RunRecord["status"],
  result: row.result ?? undefined,
  error: row.error ?? undefined,
  attempts: row.attempts,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  leaseExpiresAt: row.lease_expires_at ?? undefined,
});

export class RunsRepository {
  constructor(private readonly context: DataContext) {}

  find(id: string): Promise<RunRow | undefined> {
    return this.context.db.selectFrom("runs").selectAll().where("id", "=", id).executeTakeFirst();
  }

  findByIdempotency(projectId: string, createdBy: string, key: string): Promise<RunRow | undefined> {
    return this.context.db
      .selectFrom("runs")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("created_by", "=", createdBy)
      .where("idempotency_key", "=", key)
      .executeTakeFirst();
  }

  async pendingCount(projectId: string): Promise<number> {
    const row = await this.context.db
      .selectFrom("runs")
      .select((eb) => eb.fn.countAll().as("n"))
      .where("project_id", "=", projectId)
      .where("status", "in", ["queued", "running"])
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async insert(row: Insertable<RunsTable>): Promise<void> {
    await this.context.db.insertInto("runs").values(row).execute();
  }

  async insertIfMissing(row: Insertable<RunsTable>): Promise<void> {
    await insertIgnore(this.context, "runs", row, ["id"]);
  }

  list(projectId: string): Promise<RunRow[]> {
    const query = this.context.db
      .selectFrom("runs")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("created_at", "desc");
    return limitRows(query, this.context.dialect, 50).execute();
  }

  async ids(): Promise<string[]> {
    return (await this.context.db.selectFrom("runs").select("id").execute()).map((row) => row.id);
  }

  async expireLeases(projectId: string, now: string): Promise<void> {
    await this.context.db
      .updateTable("runs")
      .set((eb) => ({
        status: eb.case().when("attempts", ">=", 3).then("failed").else("queued").end(),
        error: "Worker lease expired",
        lease_hash: null,
        worker_id: null,
        lease_expires_at: null,
        updated_at: now,
      }))
      .where("project_id", "=", projectId)
      .where("status", "=", "running")
      .where("lease_expires_at", "<=", now)
      .execute();
  }

  async nextQueued(projectId: string): Promise<string | undefined> {
    const query = this.context.db
      .selectFrom("runs")
      .select("id")
      .where("project_id", "=", projectId)
      .where("status", "=", "queued")
      .orderBy("created_at")
      .orderBy("id");
    return (await limitRows(query, this.context.dialect, 1).executeTakeFirst())?.id;
  }

  async lease(id: string, fields: { workerId: string; leaseHash: string; expiresAt: string; now: string }) {
    const result = await this.context.db
      .updateTable("runs")
      .set((eb) => ({
        status: "running",
        attempts: eb("attempts", "+", 1),
        worker_id: fields.workerId,
        lease_hash: fields.leaseHash,
        lease_expires_at: fields.expiresAt,
        updated_at: fields.now,
        error: null,
      }))
      .where("id", "=", id)
      .where("status", "=", "queued")
      .executeTakeFirst();
    return affectedRows(result);
  }

  async updateLeased(
    id: string,
    lease: { workerId: string; leaseHash: string; now: string },
    fields: Updateable<RunsTable>,
  ): Promise<number> {
    const result = await this.context.db
      .updateTable("runs")
      .set(fields)
      .where("id", "=", id)
      .where("worker_id", "=", lease.workerId)
      .where("lease_hash", "=", lease.leaseHash)
      .where("status", "=", "running")
      .where("lease_expires_at", ">", lease.now)
      .executeTakeFirst();
    return affectedRows(result);
  }

  async cancel(id: string, now: string): Promise<number> {
    const result = await this.context.db
      .updateTable("runs")
      .set({ status: "cancelled", lease_hash: null, lease_expires_at: null, updated_at: now })
      .where("id", "=", id)
      .where("status", "in", ["queued", "running"])
      .executeTakeFirst();
    return affectedRows(result);
  }
}
