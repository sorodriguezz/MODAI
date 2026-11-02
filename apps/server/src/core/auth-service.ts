import { randomBytes, randomUUID } from "node:crypto";
import { Database } from "./database.js";
import { AppError, invariant } from "@modai/contracts/errors";
import { sha256, tokensEqual } from "@modai/contracts/security";
import type { ProjectRecord } from "@modai/contracts/types";

export type Role = "reader" | "publisher" | "worker" | "admin";
export interface Identity { id: string; label: string; role: Role; projectIds: string[]; organizationIds: string[]; packageScopes: string[] }
export interface KeyGrants { projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] }

export class AuthService {
  constructor(private readonly db: Database, private readonly bootstrapToken?: string) {}

  configured(): boolean { return Boolean(this.bootstrapToken?.trim() || this.db.connection.prepare("SELECT 1 FROM api_keys WHERE role = 'admin' AND revoked_at IS NULL LIMIT 1").get()); }

  authenticate(token?: string): Identity | undefined {
    if (!token) return undefined;
    if (this.bootstrapToken && tokensEqual(this.bootstrapToken, token)) return { id: "bootstrap", label: "bootstrap", role: "admin", projectIds: [], organizationIds: [], packageScopes: [] };
    const row = this.db.connection.prepare(`SELECT id, label, role, project_ids_json, organization_ids_json, package_scopes_json FROM api_keys
      WHERE token_hash = ? AND revoked_at IS NULL`).get(sha256(token)) as { id: string; label: string; role: Role; project_ids_json: string; organization_ids_json: string; package_scopes_json: string } | undefined;
    if (!row) return undefined;
    this.db.connection.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return { id: row.id, label: row.label, role: row.role, projectIds: JSON.parse(row.project_ids_json), organizationIds: JSON.parse(row.organization_ids_json), packageScopes: JSON.parse(row.package_scopes_json) };
  }

  require(identity: Identity | undefined, minimum: Role): Identity {
    if (!identity) throw new AppError(401, "UNAUTHORIZED", "Token inválido o ausente");
    if (identity.role !== "admin" && minimum !== "reader" && identity.role !== minimum) throw new AppError(403, "FORBIDDEN", `Se requiere rol ${minimum}`);
    return identity;
  }

  requireProject(identity: Identity | undefined, projectId: string, write = false): ProjectRecord {
    const actor = this.require(identity, "reader");
    invariant(typeof projectId === "string" && projectId.length > 0 && projectId.length <= 200, 400, "INVALID_PROJECT", "projectId es obligatorio");
    if (write && !["publisher", "worker", "admin"].includes(actor.role)) throw new AppError(403, "FORBIDDEN", "La clave no permite escribir memoria o tareas");
    const row = this.db.connection.prepare("SELECT id, name, organization_id AS organizationId, created_by AS createdBy, created_at AS createdAt FROM projects WHERE id = ?").get(projectId) as (ProjectRecord & { createdBy: string }) | undefined;
    if (!row || (actor.role !== "admin" && row.createdBy !== actor.id && !actor.projectIds.includes(projectId))) throw new AppError(403, "PROJECT_FORBIDDEN", "La clave no tiene acceso a este proyecto");
    return row;
  }

  requireOrganization(identity: Identity | undefined, organizationId?: string): void {
    const actor = this.require(identity, "reader");
    if (!organizationId || (actor.role !== "admin" && !actor.organizationIds.includes(organizationId))) throw new AppError(403, "ORGANIZATION_FORBIDDEN", "La clave no tiene acceso a esta organización");
  }

  requirePublish(identity: Identity | undefined, packageName: string): void {
    const actor = this.require(identity, "publisher");
    const scope = packageName.split("/")[0];
    if (actor.role !== "admin" && !actor.packageScopes.includes(scope) && !actor.packageScopes.includes("*")) throw new AppError(403, "PACKAGE_FORBIDDEN", "La clave no puede publicar en este namespace");
  }

  createProject(identity: Identity | undefined, input: { id?: string; name: string; organizationId?: string }): ProjectRecord {
    const actor = this.require(identity, "publisher");
    if (input.organizationId) this.requireOrganization(actor, input.organizationId);
    const id = input.id ?? randomUUID();
    const existing = this.db.connection.prepare("SELECT id FROM projects WHERE id = ?").get(id);
    if (existing) return this.requireProject(actor, id);
    const count = this.db.connection.prepare("SELECT COUNT(*) AS n FROM projects WHERE created_by = ?").get(actor.id) as { n: number };
    invariant(actor.role === "admin" || count.n < 100, 429, "PROJECT_QUOTA", "Límite de proyectos por clave alcanzado");
    const createdAt = new Date().toISOString();
    this.db.connection.prepare("INSERT INTO projects (id, name, organization_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(id, input.name, input.organizationId ?? null, actor.id, createdAt);
    return { id, name: input.name, organizationId: input.organizationId, createdAt };
  }

  listProjects(identity: Identity | undefined): ProjectRecord[] {
    const actor = this.require(identity, "reader");
    return (this.db.connection.prepare("SELECT id, name, organization_id AS organizationId, created_by AS createdBy, created_at AS createdAt FROM projects ORDER BY name").all() as Array<ProjectRecord & { createdBy: string }>).filter(row => actor.role === "admin" || row.createdBy === actor.id || actor.projectIds.includes(row.id)).map(({ createdBy, ...project }) => project);
  }

  createOrganization(name: string): { id: string; name: string } {
    const id = randomUUID();
    this.db.connection.prepare("INSERT INTO organizations VALUES (?, ?, ?)").run(id, name, new Date().toISOString());
    return { id, name };
  }

  createKey(label: string, role: Role, grants: KeyGrants = {}) {
    invariant(["reader", "publisher", "worker", "admin"].includes(role), 400, "INVALID_ROLE", "Rol inválido");
    const id = randomUUID(), token = `modai_${randomBytes(24).toString("base64url")}`, createdAt = new Date().toISOString();
    this.db.connection.prepare(`INSERT INTO api_keys (id, label, token_hash, role, created_at, project_ids_json, organization_ids_json, package_scopes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, label.trim() || "unnamed", sha256(token), role, createdAt, JSON.stringify(grants.projectIds ?? []), JSON.stringify(grants.organizationIds ?? []), JSON.stringify(grants.packageScopes ?? []));
    return { id, label, role, token, createdAt, ...grants };
  }

  updateKeyGrants(id: string, grants: KeyGrants): void {
    const changed = this.db.connection.prepare("UPDATE api_keys SET project_ids_json = ?, organization_ids_json = ?, package_scopes_json = ? WHERE id = ? AND revoked_at IS NULL").run(JSON.stringify(grants.projectIds ?? []), JSON.stringify(grants.organizationIds ?? []), JSON.stringify(grants.packageScopes ?? []), id);
    invariant(changed.changes, 404, "API_KEY_NOT_FOUND", "Clave no encontrada");
  }

  listKeys(): unknown[] {
    return (this.db.connection.prepare(`SELECT id, label, role, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt,
      project_ids_json AS projects, organization_ids_json AS organizations, package_scopes_json AS scopes FROM api_keys ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>)
      .map(({ projects, organizations, scopes, ...row }) => ({ ...row, projectIds: JSON.parse(projects as string), organizationIds: JSON.parse(organizations as string), packageScopes: JSON.parse(scopes as string) }));
  }

  revokeKey(id: string): void {
    const result = this.db.connection.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(new Date().toISOString(), id);
    if (!result.changes) throw new AppError(404, "API_KEY_NOT_FOUND", `API key no encontrada o ya revocada: ${id}`);
  }
}
