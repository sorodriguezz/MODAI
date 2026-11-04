import { randomBytes } from "node:crypto";
import { sha256 } from "@modai/contracts/security";
import type { DataContext } from "../../infrastructure/database/database.js";
import { type Identity, userIdentity } from "./identity.js";
import { SessionsRepository } from "./sessions.repository.js";
import { toUser, UsersRepository } from "./users.repository.js";

export interface SessionOptions {
  idleMs?: number;
  absoluteMs?: number;
}

export interface CreatedSession {
  token: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  maxAgeSeconds: number;
}

export class SessionsService {
  private readonly idleMs: number;
  private readonly absoluteMs: number;
  private readonly sessions: SessionsRepository;
  private readonly users: UsersRepository;

  constructor(context: DataContext, options: SessionOptions = {}) {
    this.idleMs = options.idleMs ?? 12 * 3_600_000;
    this.absoluteMs = options.absoluteMs ?? 7 * 86_400_000;
    this.sessions = new SessionsRepository(context);
    this.users = new UsersRepository(context);
  }

  async create(userId: string, meta: { userAgent?: string; ip?: string } = {}): Promise<CreatedSession> {
    const token = randomBytes(32).toString("base64url"),
      now = Date.now();
    const expiresAt = new Date(Math.min(now + this.idleMs, now + this.absoluteMs)).toISOString();
    const absoluteExpiresAt = new Date(now + this.absoluteMs).toISOString(),
      iso = new Date(now).toISOString();
    await this.sessions.deleteExpired(iso);
    await this.sessions.insert({
      token_hash: sha256(token),
      user_id: userId,
      created_at: iso,
      last_seen_at: iso,
      expires_at: expiresAt,
      absolute_expires_at: absoluteExpiresAt,
      user_agent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip?.slice(0, 100) ?? null,
    });
    await this.users.setLastLogin(userId, iso);
    return { token, expiresAt, absoluteExpiresAt, maxAgeSeconds: Math.floor(this.absoluteMs / 1000) };
  }

  async authenticate(token?: string): Promise<Identity | undefined> {
    if (!token || token.length > 200) return undefined;
    const hash = sha256(token);
    const row = await this.sessions.findWithUser(hash);
    if (!row) return undefined;
    const now = Date.now();
    if (row.disabled_at || Date.parse(row.expires_at) <= now || Date.parse(row.absolute_expires_at) <= now) {
      await this.sessions.delete(hash);
      return undefined;
    }
    if (now - Date.parse(row.last_seen_at) > 60_000) {
      const expiresAt = new Date(Math.min(now + this.idleMs, Date.parse(row.absolute_expires_at))).toISOString();
      await this.sessions.touch(hash, new Date(now).toISOString(), expiresAt);
    }
    return userIdentity(toUser(row));
  }

  async delete(token?: string): Promise<void> {
    if (token) await this.sessions.delete(sha256(token));
  }
}
