import { randomBytes, randomUUID } from "node:crypto";
import { Database } from "./database.js";
import { AppError } from "./errors.js";
import { sha256, tokensEqual } from "./security.js";

export type Role = "reader" | "publisher" | "admin";

const ROLE_LEVEL: Record<Role, number> = { reader: 1, publisher: 2, admin: 3 };

export interface Identity {
  id: string;
  label: string;
  role: Role;
}

export class AuthService {
  constructor(private readonly db: Database, private readonly bootstrapToken?: string) {}

  authenticate(token?: string): Identity | undefined {
    if (!this.bootstrapToken && !this.hasActiveKeys()) return { id: "local", label: "local-anonymous", role: "admin" };
    if (!token) return undefined;
    if (this.bootstrapToken && tokensEqual(this.bootstrapToken, token)) return { id: "bootstrap", label: "bootstrap", role: "admin" };
    const row = this.db.connection.prepare(`SELECT id, label, role FROM api_keys
      WHERE token_hash = ? AND revoked_at IS NULL`).get(sha256(token)) as { id: string; label: string; role: Role } | undefined;
    if (!row) return undefined;
    this.db.connection.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return row;
  }

  require(identity: Identity | undefined, minimum: Role): Identity {
    if (!identity) throw new AppError(401, "UNAUTHORIZED", "Token inválido o ausente");
    if (ROLE_LEVEL[identity.role] < ROLE_LEVEL[minimum]) throw new AppError(403, "FORBIDDEN", `Se requiere rol ${minimum}`);
    return identity;
  }

  createKey(label: string, role: Role): { id: string; label: string; role: Role; token: string; createdAt: string } {
    if (!(role in ROLE_LEVEL)) throw new AppError(400, "INVALID_ROLE", "role debe ser reader, publisher o admin");
    const id = randomUUID();
    const token = `modai_${randomBytes(24).toString("base64url")}`;
    const createdAt = new Date().toISOString();
    this.db.connection.prepare("INSERT INTO api_keys (id, label, token_hash, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, label.trim() || "unnamed", sha256(token), role, createdAt);
    return { id, label, role, token, createdAt };
  }

  listKeys(): unknown[] {
    return this.db.connection.prepare(`SELECT id, label, role, created_at AS createdAt,
      last_used_at AS lastUsedAt, revoked_at AS revokedAt FROM api_keys ORDER BY created_at DESC`).all();
  }

  revokeKey(id: string): void {
    const result = this.db.connection.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), id);
    if (!result.changes) throw new AppError(404, "API_KEY_NOT_FOUND", `API key no encontrada o ya revocada: ${id}`);
  }

  private hasActiveKeys(): boolean {
    return Boolean(this.db.connection.prepare("SELECT 1 FROM api_keys WHERE revoked_at IS NULL LIMIT 1").get());
  }
}
