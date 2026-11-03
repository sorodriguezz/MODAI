import { randomBytes, randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import type { AgentBundle, ClaimedRun, RunRecord } from "@modai/contracts/types";
import type { Database } from "./database.js";

type Row = {
  id: string;
  project_id: string;
  agent_name: string;
  agent_version: string;
  task: string;
  bundle_json: string;
  status: RunRecord["status"];
  result: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  lease_expires_at: string | null;
};
function record(row: Row): RunRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    agentName: row.agent_name,
    agentVersion: row.agent_version,
    task: row.task,
    bundle: JSON.parse(row.bundle_json),
    status: row.status,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leaseExpiresAt: row.lease_expires_at ?? undefined,
  };
}
export class RunService {
  constructor(
    private readonly db: Database,
    private readonly leaseMs = 60_000,
  ) {}
  submit(bundle: AgentBundle, task: string, actorId: string, idempotencyKey?: string): RunRecord {
    return this.db.connection
      .transaction(() => {
        if (idempotencyKey) {
          const old = this.db.connection
            .prepare("SELECT * FROM runs WHERE project_id = ? AND created_by = ? AND idempotency_key = ?")
            .get(bundle.projectId, actorId, idempotencyKey) as Row | undefined;
          if (old) {
            invariant(
              old.task === task && JSON.parse(old.bundle_json).digest === bundle.digest,
              409,
              "IDEMPOTENCY_CONFLICT",
              "La clave de idempotencia ya se usó con otra tarea o definición",
            );
            return record(old);
          }
        }
        const count = this.db.connection
          .prepare("SELECT COUNT(*) AS n FROM runs WHERE project_id = ? AND status IN ('queued', 'running')")
          .get(bundle.projectId) as { n: number };
        invariant(count.n < 100, 429, "RUN_QUOTA", "La cola del proyecto está llena");
        const id = randomUUID(),
          now = new Date().toISOString();
        this.db.connection
          .prepare(`INSERT INTO runs (id, project_id, agent_name, agent_version, task, bundle_json, status, created_by, created_at, updated_at, idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`)
          .run(
            id,
            bundle.projectId,
            bundle.agent.name,
            bundle.agent.version,
            task,
            JSON.stringify(bundle),
            actorId,
            now,
            now,
            idempotencyKey ?? null,
          );
        return this.get(id);
      })
      .immediate();
  }
  get(id: string): RunRecord {
    const row = this.db.connection.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new AppError(404, "RUN_NOT_FOUND", "Ejecución no encontrada");
    return record(row);
  }
  list(projectId: string): RunRecord[] {
    return (
      this.db.connection
        .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50")
        .all(projectId) as Row[]
    ).map(record);
  }
  claim(projectId: string, workerId: string): ClaimedRun | undefined {
    return this.db.connection
      .transaction(() => {
        const now = new Date().toISOString();
        this.db.connection
          .prepare(`UPDATE runs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
        error = 'Worker lease expired', lease_hash = NULL, worker_id = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE project_id = ? AND status = 'running' AND lease_expires_at <= ?`)
          .run(now, projectId, now);
        const row = this.db.connection
          .prepare("SELECT id FROM runs WHERE project_id = ? AND status = 'queued' ORDER BY created_at, id LIMIT 1")
          .get(projectId) as { id: string } | undefined;
        if (!row) return undefined;
        const leaseToken = randomBytes(32).toString("base64url");
        this.db.connection
          .prepare(
            `UPDATE runs SET status = 'running', attempts = attempts + 1, worker_id = ?, lease_hash = ?, lease_expires_at = ?, updated_at = ?, error = NULL WHERE id = ?`,
          )
          .run(workerId, sha256(leaseToken), new Date(Date.now() + this.leaseMs).toISOString(), now, row.id);
        return { run: this.get(row.id), leaseToken };
      })
      .immediate();
  }
  heartbeat(id: string, workerId: string, leaseToken: string): string {
    const now = new Date().toISOString(),
      expiry = new Date(Date.now() + this.leaseMs).toISOString();
    const result = this.db.connection
      .prepare(
        `UPDATE runs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND worker_id = ? AND lease_hash = ? AND status = 'running' AND lease_expires_at > ?`,
      )
      .run(expiry, now, id, workerId, sha256(leaseToken), now);
    invariant(result.changes, 409, "LEASE_LOST", "La ejecución ya no pertenece a este worker");
    return expiry;
  }
  finish(id: string, workerId: string, leaseToken: string, result?: string, error?: string): RunRecord {
    invariant((result !== undefined) !== (error !== undefined), 400, "INVALID_RESULT", "Envía result o error");
    invariant(
      Buffer.byteLength(result ?? error ?? "") <= 1_000_000,
      413,
      "RESULT_TOO_LARGE",
      "Resultado demasiado grande",
    );
    const now = new Date().toISOString();
    const updated = this.db.connection
      .prepare(`UPDATE runs SET status = ?, result = ?, error = ?, updated_at = ?, lease_hash = NULL, lease_expires_at = NULL
      WHERE id = ? AND worker_id = ? AND lease_hash = ? AND status = 'running' AND lease_expires_at > ?`)
      .run(
        error !== undefined ? "failed" : "completed",
        result ?? null,
        error ?? null,
        now,
        id,
        workerId,
        sha256(leaseToken),
        now,
      );
    invariant(updated.changes, 409, "LEASE_LOST", "La ejecución ya no pertenece a este worker");
    return this.get(id);
  }
  cancel(id: string): RunRecord {
    const result = this.db.connection
      .prepare(
        "UPDATE runs SET status = 'cancelled', lease_hash = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')",
      )
      .run(new Date().toISOString(), id);
    invariant(result.changes, 409, "RUN_FINISHED", "La ejecución ya terminó");
    return this.get(id);
  }
}
