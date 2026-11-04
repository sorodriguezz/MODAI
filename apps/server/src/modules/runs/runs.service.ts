import { randomBytes, randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import type { AgentBundle, ClaimedRun, RunRecord } from "@modai/contracts/types";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import { RunsRepository, toRun } from "./runs.repository.js";

export class RunsService {
  private readonly runs: RunsRepository;

  constructor(
    private readonly context: DataContext,
    private readonly leaseMs = 60_000,
  ) {
    this.runs = new RunsRepository(context);
  }

  submit(bundle: AgentBundle, task: string, actorId: string, idempotencyKey?: string): Promise<RunRecord> {
    return withTransaction(this.context, async (trx) => {
      const runs = new RunsRepository(trx);
      const old = idempotencyKey ? await runs.findByIdempotency(bundle.projectId, actorId, idempotencyKey) : undefined;
      if (old) {
        invariant(
          old.task === task && JSON.parse(old.bundle_json).digest === bundle.digest,
          409,
          "IDEMPOTENCY_CONFLICT",
          "La clave de idempotencia ya se usó con otra tarea o definición",
        );
        return toRun(old);
      }
      invariant((await runs.pendingCount(bundle.projectId)) < 100, 429, "RUN_QUOTA", "La cola del proyecto está llena");
      const id = randomUUID(),
        now = new Date().toISOString();
      await runs.insert({
        id,
        project_id: bundle.projectId,
        agent_name: bundle.agent.name,
        agent_version: bundle.agent.version,
        task,
        bundle_json: JSON.stringify(bundle),
        status: "queued",
        attempts: 0,
        created_by: actorId,
        created_at: now,
        updated_at: now,
        idempotency_key: idempotencyKey ?? null,
      });
      return toRun((await runs.find(id))!);
    });
  }

  async get(id: string): Promise<RunRecord> {
    const row = await this.runs.find(id);
    if (!row) throw new AppError(404, "RUN_NOT_FOUND", "Ejecución no encontrada");
    return toRun(row);
  }

  async list(projectId: string): Promise<RunRecord[]> {
    return (await this.runs.list(projectId)).map(toRun);
  }

  claim(projectId: string, workerId: string): Promise<ClaimedRun | undefined> {
    return withTransaction(this.context, async (trx) => {
      const runs = new RunsRepository(trx);
      const now = new Date().toISOString();
      await runs.expireLeases(projectId, now);
      const id = await runs.nextQueued(projectId);
      if (!id) return undefined;
      const leaseToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + this.leaseMs).toISOString();
      if (!(await runs.lease(id, { workerId, leaseHash: sha256(leaseToken), expiresAt, now }))) return undefined;
      return { run: toRun((await runs.find(id))!), leaseToken };
    });
  }

  async heartbeat(id: string, workerId: string, leaseToken: string): Promise<string> {
    const now = new Date().toISOString(),
      expiry = new Date(Date.now() + this.leaseMs).toISOString();
    const changed = await this.runs.updateLeased(
      id,
      { workerId, leaseHash: sha256(leaseToken), now },
      { lease_expires_at: expiry, updated_at: now },
    );
    invariant(changed, 409, "LEASE_LOST", "La ejecución ya no pertenece a este worker");
    return expiry;
  }

  async finish(id: string, workerId: string, leaseToken: string, result?: string, error?: string): Promise<RunRecord> {
    invariant((result !== undefined) !== (error !== undefined), 400, "INVALID_RESULT", "Envía result o error");
    invariant(
      Buffer.byteLength(result ?? error ?? "") <= 1_000_000,
      413,
      "RESULT_TOO_LARGE",
      "Resultado demasiado grande",
    );
    const now = new Date().toISOString();
    const changed = await this.runs.updateLeased(
      id,
      { workerId, leaseHash: sha256(leaseToken), now },
      {
        status: error !== undefined ? "failed" : "completed",
        result: result ?? null,
        error: error ?? null,
        updated_at: now,
        lease_hash: null,
        lease_expires_at: null,
      },
    );
    invariant(changed, 409, "LEASE_LOST", "La ejecución ya no pertenece a este worker");
    return this.get(id);
  }

  async cancel(id: string): Promise<RunRecord> {
    invariant(await this.runs.cancel(id, new Date().toISOString()), 409, "RUN_FINISHED", "La ejecución ya terminó");
    return this.get(id);
  }
}
