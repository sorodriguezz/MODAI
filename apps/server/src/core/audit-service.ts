import { randomUUID } from "node:crypto";
import { Database } from "./database.js";

export class AuditService {
  constructor(private readonly db: Database) {}

  record(actor: string, action: string, resource: string, details: unknown = {}): void {
    this.db.connection.prepare(`INSERT INTO audit_log
      (id, actor, action, resource, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), actor, action, resource, JSON.stringify(details), new Date().toISOString());
  }

  list(limit = 100): unknown[] {
    return (this.db.connection.prepare(`SELECT id, actor, action, resource,
      details_json AS detailsJson, created_at AS createdAt FROM audit_log
      ORDER BY created_at DESC LIMIT ?`).all(Math.min(Math.max(limit, 1), 1000)) as Array<Record<string, unknown>>)
      .map((item) => ({ ...item, details: JSON.parse(item.detailsJson as string), detailsJson: undefined }));
  }

  prune(days: number): number {
    const cutoff = new Date(Date.now() - Math.max(days, 1) * 86_400_000).toISOString();
    return this.db.connection.prepare("DELETE FROM audit_log WHERE created_at < ?").run(cutoff).changes;
  }
}
