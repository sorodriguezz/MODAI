import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { DataContext } from "../../infrastructure/database/database.js";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import { AuditRepository } from "./audit.repository.js";

export class AuditService {
  private readonly audit: AuditRepository;

  constructor(context: DataContext) {
    this.audit = new AuditRepository(context);
  }

  async record(actor: string, action: string, resource: string, details: unknown = {}): Promise<void> {
    await this.audit.insert({
      id: randomUUID(),
      actor,
      action,
      resource,
      details_json: JSON.stringify(details ?? {}),
      created_at: new Date().toISOString(),
    });
  }

  fromRequest(request: FastifyRequest, action: string, resource: string, details?: unknown): Promise<void> {
    return this.record(identityOf(request)?.label ?? "anonymous", action, resource, details);
  }

  async list(limit = 100): Promise<unknown[]> {
    const rows = await this.audit.list(Math.min(Math.max(limit, 1), 1000));
    return rows.map((item) => ({ ...item, details: JSON.parse(item.detailsJson), detailsJson: undefined }));
  }

  prune(days: number, dryRun = false): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(days, 0) * 86_400_000).toISOString();
    return dryRun ? this.audit.countBefore(cutoff) : this.audit.deleteBefore(cutoff);
  }
}
