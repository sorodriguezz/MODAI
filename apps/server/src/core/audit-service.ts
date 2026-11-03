import { randomUUID } from "node:crypto";
import type { Database } from "./database.js";

export class AuditService {
  constructor(private readonly db: Database) {}

  record(actor: string, action: string, resource: string, details: unknown = {}): void {
    this.db.connection
      .prepare(`INSERT INTO audit_log
      (id, actor, action, resource, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), actor, action, resource, JSON.stringify(details), new Date().toISOString());
  }

  list(limit = 100): unknown[] {
    return (
      this.db.connection
        .prepare(`SELECT id, actor, action, resource,
      details_json AS detailsJson, created_at AS createdAt FROM audit_log
      ORDER BY created_at DESC LIMIT ?`)
        .all(Math.min(Math.max(limit, 1), 1000)) as Array<Record<string, unknown>>
    ).map((item) => ({ ...item, details: JSON.parse(item.detailsJson as string), detailsJson: undefined }));
  }

  /** Deletes events older than `days` days (0 = all of them). `dryRun` only counts. */
  prune(days: number, dryRun = false): number {
    const cutoff = new Date(Date.now() - Math.max(days, 0) * 86_400_000).toISOString();
    if (dryRun)
      return (
        this.db.connection.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE created_at < ?").get(cutoff) as {
          n: number;
        }
      ).n;
    return this.db.connection.prepare("DELETE FROM audit_log WHERE created_at < ?").run(cutoff).changes;
  }
}
