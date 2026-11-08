import type { AgentBundle, RunRecord } from "@modai/contracts/types";
import { type Insertable, type Selectable, sql, type Updateable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { RunsTable } from "../../infrastructure/database/schema.js";
import { affectedRows, limitRows, toNumber } from "../../infrastructure/database/sql-helpers.js";
import { insertIgnore } from "../../infrastructure/database/upsert.js";
import type { PackageVisibilityFilter } from "../auth/namespace-access.js";
import { bundlePackageNames } from "./bundle-packages.js";

export type RunRow = Selectable<RunsTable>;

export const toRun = (row: RunRow): RunRecord => {
  const bundle: AgentBundle = JSON.parse(row.bundle_json);
  return {
    id: row.id,
    projectId: row.project_id,
    requestedBy: row.created_by,
    agentName: row.agent_name,
    agentVersion: row.agent_version,
    task: row.task,
    bundle,
    organizationId: bundle.organizationId,
    status: row.status as RunRecord["status"],
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
  };
};

export class RunsRepository {
  constructor(private readonly context: DataContext) {}

  private visibleRuns(visible?: PackageVisibilityFilter) {
    const { db } = this.context;
    const query = db.selectFrom("runs");
    if (!visible) return query;
    return query.where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("run_packages")
            .select("run_id")
            .whereRef("run_id", "=", "runs.id")
            .where(sql<boolean>`not ${visible(db, "run_packages.package_name")}`),
        ),
      ),
    );
  }

  find(id: string, visible?: PackageVisibilityFilter): Promise<RunRow | undefined> {
    return this.visibleRuns(visible).selectAll().where("id", "=", id).executeTakeFirst();
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
    const names = bundlePackageNames(JSON.parse(row.bundle_json) as AgentBundle);
    await this.context.db
      .insertInto("run_packages")
      .values(names.map((package_name) => ({ run_id: row.id, package_name })))
      .execute();
  }

  async insertIfMissing(row: Insertable<RunsTable>): Promise<void> {
    await insertIgnore(this.context, "runs", row, ["id"]);
    const existing = (await this.find(row.id))!;
    for (const package_name of bundlePackageNames(JSON.parse(existing.bundle_json) as AgentBundle))
      await insertIgnore(this.context, "run_packages", { run_id: row.id, package_name }, ["run_id", "package_name"]);
  }

  list(projectId: string, visible?: PackageVisibilityFilter): Promise<RunRow[]> {
    const query = this.visibleRuns(visible)
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

  queued(projectId: string, visible?: PackageVisibilityFilter, offset = 0) {
    const query = this.visibleRuns(visible)
      .select(["id", "bundle_json"])
      .where("project_id", "=", projectId)
      .where("status", "=", "queued")
      .orderBy("created_at")
      .orderBy("id");
    return limitRows(query, this.context.dialect, 100, offset).execute();
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
