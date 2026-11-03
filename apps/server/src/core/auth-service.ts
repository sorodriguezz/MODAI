import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { Database } from "./database.js";
import { AppError, invariant } from "@modai/contracts/errors";
import { sha256, tokensEqual } from "@modai/contracts/security";
import type { ProjectRecord } from "@modai/contracts/types";

export type Role = "reader" | "publisher" | "worker" | "org-admin" | "admin";
export interface Identity { id: string; label: string; role: Role; projectIds: string[]; organizationIds: string[]; packageScopes: string[]; kind?: "bootstrap" | "api-key" | "user"; ownerId?: string; ownerName?: string }
export interface KeyOptions { ownerId?: string | null; inherit?: boolean }
export interface KeyRecord extends Grantee { id: string; label: string; createdAt: string; lastUsedAt?: string; revokedAt?: string; ownerId?: string; ownerName?: string; inherit: boolean }
export interface KeyGrants { projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] }
export interface UserRecord { id: string; username: string; displayName: string; role: Role; projectIds: string[]; organizationIds: string[]; packageScopes: string[]; createdAt: string; updatedAt: string; lastLoginAt?: string; disabledAt?: string }
export interface UserInput extends KeyGrants { username: string; displayName?: string; password: string; role: Role }
export interface UserUpdate extends KeyGrants { displayName?: string; role?: Role; disabled?: boolean; password?: string }
export interface SessionOptions { idleMs?: number; absoluteMs?: number }
export interface CreatedSession { token: string; expiresAt: string; absoluteExpiresAt: string; maxAgeSeconds: number }

export const ROLES: Role[] = ["reader", "publisher", "worker", "org-admin", "admin"];
/** Roles an organization admin may hand out: never global admin. */
const DELEGABLE_ROLES: Role[] = ["reader", "publisher", "worker", "org-admin"];
export interface Grantee { role: Role; projectIds: string[]; organizationIds: string[]; packageScopes: string[] }
export interface Permissions {
  role: Role; global: boolean;
  manage: { users: boolean; apiKeys: boolean; organizations: boolean; createOrganizations: boolean; namespaces: boolean; audit: boolean; publishers: boolean; backup: boolean; packages: boolean };
  assignableRoles: Role[];
  createProjects: boolean; writeMemory: boolean; submitRuns: boolean;
  publish: { all: boolean; namespaces: string[] };
  /** Namespaces whose packages it may deprecate or yank. */
  packages: { all: boolean; namespaces: string[] };
  organizations: Array<{ id: string; name: string; manage: boolean }>;
}
/** Namespace of a package name: "@team/pkg" → "@team". */
export const namespaceOf = (packageName: string): string => packageName.split("/")[0];
export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 256;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
// scrypt cost: N=2^15, r=8, p=1 (~32 MiB, tens of ms). Encoded with the parameters so they can be raised later.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };
const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, keylen, options, (error, key) => error ? reject(error) : resolve(key)));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash used when the username does not exist, so the response time does not reveal valid accounts. */
let decoyHash: Promise<string> | undefined;

type UserRow = { id: string; username: string; display_name: string; password_hash: string; role: Role; project_ids_json: string; organization_ids_json: string; package_scopes_json: string; created_at: string; updated_at: string; last_login_at: string | null; disabled_at: string | null };
const toUser = (row: UserRow): UserRecord => ({
  id: row.id, username: row.username, displayName: row.display_name, role: row.role,
  projectIds: JSON.parse(row.project_ids_json), organizationIds: JSON.parse(row.organization_ids_json), packageScopes: JSON.parse(row.package_scopes_json),
  createdAt: row.created_at, updatedAt: row.updated_at, ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}), ...(row.disabled_at ? { disabledAt: row.disabled_at } : {}),
});

export class AuthService {
  private readonly idleMs: number;
  private readonly absoluteMs: number;
  private readonly failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

  constructor(private readonly db: Database, private readonly bootstrapToken?: string, sessions: SessionOptions = {}) {
    this.idleMs = sessions.idleMs ?? 12 * 3_600_000;
    this.absoluteMs = sessions.absoluteMs ?? 7 * 86_400_000;
  }

  configured(): boolean { return Boolean(this.bootstrapToken?.trim() || this.db.connection.prepare("SELECT 1 FROM api_keys WHERE role = 'admin' AND revoked_at IS NULL LIMIT 1").get() || this.activeAdminCount() > 0); }

  /** True when the bootstrap secret (MODAI_API_TOKEN) or an active admin API key is supplied. */
  isBootstrapCredential(token: string | undefined): boolean {
    if (!token) return false;
    const identity = this.authenticate(token);
    return identity?.role === "admin" && identity.kind !== "user";
  }

  authenticate(token?: string): Identity | undefined {
    if (!token) return undefined;
    if (this.bootstrapToken && tokensEqual(this.bootstrapToken, token)) return { id: "bootstrap", label: "bootstrap", role: "admin", projectIds: [], organizationIds: [], packageScopes: [], kind: "bootstrap" };
    const row = this.db.connection.prepare(`SELECT id, label, role, project_ids_json, organization_ids_json, package_scopes_json, owner_user_id, inherit_grants FROM api_keys
      WHERE token_hash = ? AND revoked_at IS NULL`).get(sha256(token)) as { id: string; label: string; role: Role; project_ids_json: string; organization_ids_json: string; package_scopes_json: string; owner_user_id: string | null; inherit_grants: number } | undefined;
    if (!row) return undefined;
    const grants = { projectIds: JSON.parse(row.project_ids_json), organizationIds: JSON.parse(row.organization_ids_json), packageScopes: JSON.parse(row.package_scopes_json) };
    let identity: Identity = { id: row.id, label: row.label, role: row.role, ...grants, kind: "api-key" };
    if (row.owner_user_id) {
      const owner = this.db.connection.prepare("SELECT * FROM users WHERE id = ?").get(row.owner_user_id) as UserRow | undefined;
      // A disabled or deleted owner disables its keys; a narrower owner narrows them (evaluated on every request).
      if (!owner || owner.disabled_at) return undefined;
      const bound = this.boundToOwner(this.userIdentity(toUser(owner)), row.role, grants, Boolean(row.inherit_grants));
      if (!bound) return undefined;
      identity = { ...bound, id: row.id, label: `${owner.username} · ${row.label}`, kind: "api-key", ownerId: owner.id, ownerName: owner.username };
    }
    this.db.connection.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return identity;
  }

  userIdentity(user: UserRecord): Identity {
    return { id: user.id, label: user.username, role: user.role, projectIds: user.projectIds, organizationIds: user.organizationIds, packageScopes: user.packageScopes, kind: "user" };
  }

  /** A key may have the owner's role or a narrower one; "worker" fits any account that can publish. */
  keyRoleAllowed(ownerRole: Role, keyRole: Role): boolean {
    return this.satisfies(ownerRole, keyRole) || (keyRole === "worker" && this.satisfies(ownerRole, "publisher"));
  }

  /** Projects the owner can see, namespaces it can use and organizations it belongs to: the ceiling for its keys. */
  private ownerCeiling(owner: Identity): { all: boolean; projects: Set<string>; organizations: Set<string>; scopes: Set<string>; anyScope: boolean } {
    if (owner.role === "admin") return { all: true, projects: new Set(), organizations: new Set(), scopes: new Set(), anyScope: true };
    const projects = new Set((this.db.connection.prepare("SELECT id, organization_id AS organizationId, created_by AS createdBy FROM projects").all() as Array<{ id: string; organizationId: string | null; createdBy: string }>).filter(row => this.seesProject(owner, row)).map(row => row.id));
    const scopes = new Set([...owner.packageScopes, ...(owner.role === "org-admin" ? this.managedNamespaces(owner).namespaces : [])]);
    return { all: false, projects, organizations: new Set(owner.organizationIds), scopes, anyScope: owner.packageScopes.includes("*") };
  }

  /** Effective identity of a key: its role (if the owner still allows it) and its grants intersected with the owner's. */
  boundToOwner(owner: Identity, role: Role, grants: Required<KeyGrants>, inherit: boolean): Identity | undefined {
    if (!this.keyRoleAllowed(owner.role, role)) return undefined;
    if (inherit) return { ...owner, role, projectIds: owner.projectIds, organizationIds: owner.organizationIds, packageScopes: owner.packageScopes };
    const ceiling = this.ownerCeiling(owner);
    if (ceiling.all) return { ...owner, role, ...grants };
    return {
      ...owner, role,
      projectIds: grants.projectIds.filter(id => ceiling.projects.has(id)),
      organizationIds: grants.organizationIds.filter(id => ceiling.organizations.has(id)),
      packageScopes: grants.packageScopes.filter(scope => ceiling.anyScope || (scope !== "*" && ceiling.scopes.has(scope))),
    };
  }

  /** At creation, a key that would exceed its owner is refused with what is wrong (instead of silently trimmed). */
  assertKeyWithinOwner(owner: UserRecord, role: Role, grants: KeyGrants, inherit: boolean): void {
    invariant(ROLES.includes(role), 400, "INVALID_ROLE", "Rol inválido");
    if (owner.disabledAt) throw new AppError(409, "OWNER_DISABLED", `${owner.username} está desactivado`);
    if (!this.keyRoleAllowed(owner.role, role)) throw new AppError(403, "KEY_EXCEEDS_OWNER", `Una API key de ${owner.username} no puede tener el rol ${role}: su cuenta es ${owner.role}`);
    if (inherit || owner.role === "admin") return;
    const ceiling = this.ownerCeiling(this.userIdentity(owner));
    const outside = [
      ...(grants.organizationIds ?? []).filter(id => !ceiling.organizations.has(id)).map(id => `organización ${id}`),
      ...(grants.projectIds ?? []).filter(id => !ceiling.projects.has(id)).map(id => `proyecto ${id}`),
      ...(grants.packageScopes ?? []).filter(scope => !(ceiling.anyScope || (scope !== "*" && ceiling.scopes.has(scope)))).map(scope => `namespace ${scope}`),
    ];
    if (outside.length) throw new AppError(403, "KEY_EXCEEDS_OWNER", `La API key no puede tener más acceso que ${owner.username}: ${outside.join(", ")}`);
  }

  require(identity: Identity | undefined, minimum: Role): Identity {
    if (!identity) throw new AppError(401, "UNAUTHORIZED", "Token inválido o ausente");
    if (!this.satisfies(identity.role, minimum)) throw new AppError(403, "FORBIDDEN", `Se requiere rol ${minimum}`);
    return identity;
  }

  /** Global admin passes everything; an organization admin also publishes and writes inside its organizations. */
  satisfies(role: Role, minimum: Role): boolean {
    if (role === "admin" || minimum === "reader" || role === minimum) return true;
    return role === "org-admin" && minimum === "publisher";
  }

  /** Organizations the actor administers: undefined means all of them (global admin). */
  managedOrganizations(actor: Identity): string[] | undefined {
    if (actor.role === "admin") return undefined;
    return actor.role === "org-admin" ? actor.organizationIds : [];
  }

  administers(actor: Identity, organizationId: string | null | undefined): boolean {
    const managed = this.managedOrganizations(actor);
    return managed === undefined || (Boolean(organizationId) && managed.includes(organizationId!));
  }

  /** Users and API keys, organizations and namespaces: only global admins and organization admins. */
  requireManager(identity: Identity | undefined): Identity {
    const actor = this.require(identity, "reader");
    if (actor.role !== "admin" && actor.role !== "org-admin") throw new AppError(403, "FORBIDDEN", "Se requiere administración global o de organización");
    return actor;
  }

  /** A grantee is managed by an organization admin only when every organization it belongs to is one the admin manages. */
  canManageGrantee(actor: Identity, target: Grantee): boolean {
    const managed = this.managedOrganizations(actor);
    if (managed === undefined) return true;
    return target.role !== "admin" && target.organizationIds.length > 0 && target.organizationIds.every(id => managed.includes(id));
  }

  /**
   * Hierarchy check for grants handed out by an organization admin: organizations it manages, projects inside those
   * organizations and namespaces owned by them. Global admins keep the free form (unknown ids are allowed for compatibility).
   */
  assertGrants(actor: Identity, role: Role, grants: KeyGrants): void {
    invariant(ROLES.includes(role), 400, "INVALID_ROLE", "Rol inválido");
    const managed = this.managedOrganizations(actor);
    if (managed === undefined) return;
    if (!DELEGABLE_ROLES.includes(role)) throw new AppError(403, "ROLE_FORBIDDEN", "Solo la administración global puede asignar el rol de administración");
    const organizations = grants.organizationIds ?? [];
    invariant(organizations.length > 0, 400, "ORGANIZATION_REQUIRED", "Asigna al menos una organización");
    const outside = organizations.filter(id => !managed.includes(id));
    if (outside.length) throw new AppError(403, "ORGANIZATION_FORBIDDEN", `No administras estas organizaciones: ${outside.join(", ")}`);
    for (const projectId of grants.projectIds ?? []) {
      const project = this.db.connection.prepare("SELECT organization_id AS organizationId FROM projects WHERE id = ?").get(projectId) as { organizationId: string | null } | undefined;
      if (!project) throw new AppError(400, "PROJECT_NOT_FOUND", `No existe el proyecto ${projectId}`);
      if (!project.organizationId || !organizations.includes(project.organizationId)) throw new AppError(400, "PROJECT_OUTSIDE_ORGANIZATION", `El proyecto ${projectId} no pertenece a las organizaciones asignadas`);
    }
    for (const scope of grants.packageScopes ?? []) {
      if (scope === "*") throw new AppError(403, "NAMESPACE_FORBIDDEN", "Solo la administración global puede dar acceso a todos los namespaces");
      const namespace = this.db.connection.prepare("SELECT organization_id AS organizationId FROM namespaces WHERE name = ?").get(scope) as { organizationId: string | null } | undefined;
      if (!namespace) throw new AppError(400, "NAMESPACE_NOT_FOUND", `No existe el namespace ${scope}`);
      if (!namespace.organizationId || !organizations.includes(namespace.organizationId)) throw new AppError(400, "NAMESPACE_OUTSIDE_ORGANIZATION", `El namespace ${scope} no pertenece a las organizaciones asignadas`);
    }
  }

  /**
   * Package visibility. Namespaces are 'internal' (any authenticated identity reads them) or 'restricted'
   * (only identities granted the namespace, or administering its organization). Evaluated once per request.
   */
  packageReader(identity: Identity | undefined): (packageName: string) => boolean {
    const actor = this.require(identity, "reader");
    if (actor.role === "admin" || actor.packageScopes.includes("*")) return () => true;
    const restricted = new Map((this.db.connection.prepare("SELECT name, organization_id AS organizationId FROM namespaces WHERE visibility = 'restricted'").all() as Array<{ name: string; organizationId: string | null }>).map(row => [row.name, row.organizationId]));
    return (packageName) => {
      const scope = namespaceOf(packageName);
      if (!restricted.has(scope)) return true;
      return actor.packageScopes.includes(scope) || (actor.role === "org-admin" && this.administers(actor, restricted.get(scope)));
    };
  }

  requireReadPackage(identity: Identity | undefined, packageName: string): void {
    if (!this.packageReader(identity)(packageName)) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${packageName}`);
  }

  /** Namespaces the actor may publish to; `all` for global admins and the "*" grant. */
  publishableNamespaces(actor: Identity): { all: boolean; namespaces: string[] } {
    if (!this.satisfies(actor.role, "publisher")) return { all: false, namespaces: [] };
    if (actor.role === "admin" || actor.packageScopes.includes("*")) return { all: true, namespaces: [] };
    const owned = actor.role === "org-admin" && actor.organizationIds.length
      ? (this.db.connection.prepare(`SELECT name FROM namespaces WHERE organization_id IN (${actor.organizationIds.map(() => "?").join(",")})`).all(...actor.organizationIds) as Array<{ name: string }>).map(row => row.name)
      : [];
    return { all: false, namespaces: [...new Set([...actor.packageScopes, ...owned])].sort() };
  }

  /** Namespaces whose packages the actor may deprecate or yank: all for global admins, those of its organizations for an org-admin. */
  managedNamespaces(actor: Identity): { all: boolean; namespaces: string[] } {
    if (actor.role === "admin") return { all: true, namespaces: [] };
    if (actor.role !== "org-admin" || !actor.organizationIds.length) return { all: false, namespaces: [] };
    return { all: false, namespaces: (this.db.connection.prepare(`SELECT name FROM namespaces WHERE organization_id IN (${actor.organizationIds.map(() => "?").join(",")}) ORDER BY name`).all(...actor.organizationIds) as Array<{ name: string }>).map(row => row.name) };
  }

  /** Deprecate and yank: global admins, or the admin of the organization that owns the package's namespace. */
  requireManagePackage(identity: Identity | undefined, packageName: string): Identity {
    const actor = this.requireManager(identity);
    const managed = this.managedNamespaces(actor);
    if (!managed.all && !managed.namespaces.includes(namespaceOf(packageName))) throw new AppError(403, "PACKAGE_FORBIDDEN", `No administras el namespace ${namespaceOf(packageName)}`);
    return actor;
  }

  /** What the panel and the CLI may show for this identity. Mirrors every check above. */
  permissions(identity: Identity | undefined): Permissions {
    const actor = this.require(identity, "reader");
    const global = actor.role === "admin", manager = global || actor.role === "org-admin";
    const rows = (global
      ? this.db.connection.prepare("SELECT id, name FROM organizations ORDER BY name").all()
      : actor.organizationIds.length ? this.db.connection.prepare(`SELECT id, name FROM organizations WHERE id IN (${actor.organizationIds.map(() => "?").join(",")}) ORDER BY name`).all(...actor.organizationIds) : []) as Array<{ id: string; name: string }>;
    return {
      role: actor.role, global,
      manage: { users: manager, apiKeys: manager, organizations: manager, createOrganizations: global, namespaces: manager, audit: global, publishers: global, backup: global, packages: global },
      assignableRoles: global ? ROLES : manager ? DELEGABLE_ROLES : [],
      createProjects: this.satisfies(actor.role, "publisher"),
      writeMemory: ["publisher", "worker", "org-admin", "admin"].includes(actor.role),
      submitRuns: this.satisfies(actor.role, "publisher"),
      publish: this.publishableNamespaces(actor),
      packages: this.managedNamespaces(actor),
      organizations: rows.map(row => ({ ...row, manage: this.administers(actor, row.id) && manager })),
    };
  }

  requireProject(identity: Identity | undefined, projectId: string, write = false): ProjectRecord {
    const actor = this.require(identity, "reader");
    invariant(typeof projectId === "string" && projectId.length > 0 && projectId.length <= 200, 400, "INVALID_PROJECT", "projectId es obligatorio");
    if (write && !["publisher", "worker", "org-admin", "admin"].includes(actor.role)) throw new AppError(403, "FORBIDDEN", "La clave no permite escribir memoria o tareas");
    const row = this.db.connection.prepare("SELECT id, name, organization_id AS organizationId, created_by AS createdBy, created_at AS createdAt FROM projects WHERE id = ?").get(projectId) as (ProjectRecord & { createdBy: string }) | undefined;
    if (!row || !this.seesProject(actor, row)) throw new AppError(403, "PROJECT_FORBIDDEN", "La clave no tiene acceso a este proyecto");
    const { createdBy, ...project } = row;
    return project;
  }

  private seesProject(actor: Identity, row: { id: string; organizationId?: string | null; createdBy: string }): boolean {
    return actor.role === "admin" || row.createdBy === actor.id || (Boolean(actor.ownerId) && row.createdBy === actor.ownerId) || actor.projectIds.includes(row.id) || (actor.role === "org-admin" && this.administers(actor, row.organizationId));
  }

  /** Rename a project or move it between organizations. Moving requires administering both organizations. */
  updateProject(identity: Identity | undefined, id: string, input: { name?: string; organizationId?: string | null }): ProjectRecord {
    const actor = this.require(identity, "publisher");
    const current = this.requireProject(actor, id);
    const createdBy = (this.db.connection.prepare("SELECT created_by AS createdBy FROM projects WHERE id = ?").get(id) as { createdBy: string }).createdBy;
    const global = actor.role === "admin";
    const managesCurrent = global || (actor.role === "org-admin" && this.administers(actor, current.organizationId));
    if (!managesCurrent && createdBy !== actor.id && createdBy !== actor.ownerId) throw new AppError(403, "FORBIDDEN", "Solo la administración de la organización o quien creó el proyecto puede editarlo");
    if (input.organizationId !== undefined && (input.organizationId ?? null) !== (current.organizationId ?? null)) {
      if (!managesCurrent) throw new AppError(403, "ORGANIZATION_FORBIDDEN", "Solo la administración puede mover un proyecto de organización");
      if (input.organizationId) {
        this.requireOrganizationExists(input.organizationId);
        if (!this.administers(actor, input.organizationId)) throw new AppError(403, "ORGANIZATION_FORBIDDEN", "No administras la organización de destino");
      } else if (!global) throw new AppError(403, "ORGANIZATION_REQUIRED", "Solo la administración global puede dejar un proyecto sin organización");
    }
    const name = input.name?.trim() ?? current.name;
    invariant(name.length > 0 && name.length <= 200, 400, "INVALID_INPUT", "El nombre es obligatorio");
    const organizationId = input.organizationId === undefined ? current.organizationId ?? null : input.organizationId;
    this.db.connection.prepare("UPDATE projects SET name = ?, organization_id = ? WHERE id = ?").run(name, organizationId, id);
    return this.requireProject(actor, id);
  }

  requireOrganization(identity: Identity | undefined, organizationId?: string): void {
    const actor = this.require(identity, "reader");
    if (!organizationId || (actor.role !== "admin" && !actor.organizationIds.includes(organizationId))) throw new AppError(403, "ORGANIZATION_FORBIDDEN", "La clave no tiene acceso a esta organización");
  }

  requirePublish(identity: Identity | undefined, packageName: string): void {
    const actor = this.require(identity, "publisher");
    const allowed = this.publishableNamespaces(actor);
    const scope = namespaceOf(packageName);
    if (!allowed.all && !allowed.namespaces.includes(scope)) throw new AppError(403, "PACKAGE_FORBIDDEN", `La clave no puede publicar en el namespace ${scope}. Pide acceso a la administración de su organización.`);
  }

  /** Registers the namespace of a published package the first time it is used (no owner: global admins decide later). */
  ensureNamespace(packageName: string, actor: Identity): void {
    const now = new Date().toISOString();
    this.db.connection.prepare("INSERT OR IGNORE INTO namespaces (name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?)").run(namespaceOf(packageName), actor.id, now, now);
  }

  createProject(identity: Identity | undefined, input: { id?: string; name: string; organizationId?: string }): ProjectRecord {
    const actor = this.require(identity, "publisher");
    if (actor.role === "org-admin" && !input.organizationId) throw new AppError(400, "ORGANIZATION_REQUIRED", "Elige la organización del proyecto");
    if (input.organizationId) { this.requireOrganizationExists(input.organizationId); this.requireOrganization(actor, input.organizationId); }
    const id = input.id ?? randomUUID();
    const existing = this.db.connection.prepare("SELECT id FROM projects WHERE id = ?").get(id);
    if (existing) return this.requireProject(actor, id);
    const count = this.db.connection.prepare("SELECT COUNT(*) AS n FROM projects WHERE created_by = ?").get(actor.id) as { n: number };
    invariant(actor.role === "admin" || count.n < 100, 429, "PROJECT_QUOTA", "Límite de proyectos por clave alcanzado");
    const createdAt = new Date().toISOString();
    this.db.connection.prepare("INSERT INTO projects (id, name, organization_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(id, input.name, input.organizationId ?? null, actor.ownerId ?? actor.id, createdAt);
    return { id, name: input.name, organizationId: input.organizationId, createdAt };
  }

  /**
   * Deletes a project with its memories, runs and usage reports, and removes it from every key and user grant.
   * Organization memories survive: they belong to the organization, not to the project that wrote them.
   * Only an admin or the project's creator may do it, and never while a worker holds a live lease on one of its runs.
   */
  deleteProject(identity: Identity | undefined, id: string): { project: ProjectRecord; memories: number; runs: number } {
    const actor = this.require(identity, "reader");
    const project = this.requireProject(actor, id);
    const createdBy = (this.db.connection.prepare("SELECT created_by AS createdBy FROM projects WHERE id = ?").get(id) as { createdBy: string }).createdBy;
    const managesIt = actor.role === "org-admin" && this.administers(actor, project.organizationId);
    if (actor.role !== "admin" && !managesIt && (actor.role === "reader" || (createdBy !== actor.id && createdBy !== actor.ownerId))) throw new AppError(403, "FORBIDDEN", "Solo la administración o quien creó el proyecto puede eliminarlo");
    const busy = this.db.connection.prepare("SELECT COUNT(*) AS n FROM runs WHERE project_id = ? AND status = 'running' AND lease_expires_at > ?").get(id, new Date().toISOString()) as { n: number };
    if (busy.n > 0) throw new AppError(409, "PROJECT_BUSY", `Hay ${busy.n} ejecución(es) en curso en este proyecto; cancélalas o espera a que terminen`);
    return this.db.connection.transaction(() => {
      const memoryIds = this.db.connection.prepare("SELECT id FROM memories WHERE project_id = ? AND scope != 'organization'").all(id) as Array<{ id: string }>;
      for (const memory of memoryIds) this.db.connection.prepare("DELETE FROM memories_fts WHERE id = ?").run(memory.id);
      this.db.connection.prepare("DELETE FROM memories WHERE project_id = ? AND scope != 'organization'").run(id);
      const runs = this.db.connection.prepare("DELETE FROM runs WHERE project_id = ?").run(id).changes;
      this.db.connection.prepare("DELETE FROM project_installations WHERE project_id = ?").run(id);
      for (const table of ["api_keys", "users"]) {
        this.db.connection.prepare(`UPDATE ${table} SET project_ids_json = (SELECT json_group_array(value) FROM json_each(${table}.project_ids_json) WHERE value != ?)
          WHERE EXISTS (SELECT 1 FROM json_each(${table}.project_ids_json) WHERE value = ?)`).run(id, id);
      }
      this.db.connection.prepare("DELETE FROM projects WHERE id = ?").run(id);
      return { project, memories: memoryIds.length, runs: Number(runs) };
    })();
  }

  listProjects(identity: Identity | undefined): ProjectRecord[] {
    const actor = this.require(identity, "reader");
    return (this.db.connection.prepare(`SELECT p.id, p.name, p.organization_id AS organizationId, o.name AS organizationName, p.created_by AS createdBy, p.created_at AS createdAt
      FROM projects p LEFT JOIN organizations o ON o.id = p.organization_id ORDER BY p.name`).all() as Array<ProjectRecord & { createdBy: string; organizationName: string | null }>)
      .filter(row => this.seesProject(actor, row))
      .map(({ createdBy, organizationName, ...project }) => {
        const manages = actor.role === "admin" || (actor.role === "org-admin" && this.administers(actor, project.organizationId));
        return { ...project, ...(organizationName ? { organizationName } : {}), canDelete: manages || (actor.role !== "reader" && (createdBy === actor.id || createdBy === actor.ownerId)), canEdit: manages || (actor.role !== "reader" && (createdBy === actor.id || createdBy === actor.ownerId)) };
      });
  }

  requireOrganizationExists(id: string): void {
    if (!this.db.connection.prepare("SELECT 1 FROM organizations WHERE id = ?").get(id)) throw new AppError(404, "ORGANIZATION_NOT_FOUND", `No existe la organización ${id}`);
  }

  createKey(label: string, role: Role, grants: KeyGrants = {}, options: KeyOptions = {}) {
    invariant(ROLES.includes(role), 400, "INVALID_ROLE", "Rol inválido");
    const id = randomUUID(), token = `modai_${randomBytes(24).toString("base64url")}`, createdAt = new Date().toISOString();
    this.db.connection.prepare(`INSERT INTO api_keys (id, label, token_hash, role, created_at, project_ids_json, organization_ids_json, package_scopes_json, owner_user_id, inherit_grants) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, label.trim() || "unnamed", sha256(token), role, createdAt, JSON.stringify(grants.projectIds ?? []), JSON.stringify(grants.organizationIds ?? []), JSON.stringify(grants.packageScopes ?? []), options.ownerId ?? null, options.inherit ? 1 : 0);
    return { ...this.getKey(id), token };
  }

  updateKeyGrants(id: string, grants: KeyGrants, options: KeyOptions = {}): void {
    const current = this.getKey(id);
    const changed = this.db.connection.prepare("UPDATE api_keys SET project_ids_json = ?, organization_ids_json = ?, package_scopes_json = ?, owner_user_id = ?, inherit_grants = ? WHERE id = ? AND revoked_at IS NULL")
      .run(JSON.stringify(grants.projectIds ?? []), JSON.stringify(grants.organizationIds ?? []), JSON.stringify(grants.packageScopes ?? []), options.ownerId === undefined ? current.ownerId ?? null : options.ownerId, (options.inherit ?? current.inherit) ? 1 : 0, id);
    invariant(changed.changes, 404, "API_KEY_NOT_FOUND", "Clave no encontrada");
  }

  private static readonly KEY_COLUMNS = `k.id, k.label, k.role, k.created_at AS createdAt, k.last_used_at AS lastUsedAt, k.revoked_at AS revokedAt,
    k.project_ids_json AS projects, k.organization_ids_json AS organizations, k.package_scopes_json AS scopes,
    k.owner_user_id AS ownerId, u.username AS ownerName, k.inherit_grants AS inherit`;
  private static toKey({ projects, organizations, scopes, ownerId, ownerName, lastUsedAt, revokedAt, inherit, ...row }: Record<string, unknown>): KeyRecord {
    return { ...(row as { id: string; label: string; role: Role; createdAt: string }), ...(lastUsedAt ? { lastUsedAt: lastUsedAt as string } : {}), ...(revokedAt ? { revokedAt: revokedAt as string } : {}),
      ...(ownerId ? { ownerId: ownerId as string, ownerName: (ownerName as string | null) ?? "(eliminado)" } : {}), inherit: Boolean(inherit),
      projectIds: JSON.parse(projects as string), organizationIds: JSON.parse(organizations as string), packageScopes: JSON.parse(scopes as string) };
  }

  getKey(id: string): KeyRecord {
    const row = this.db.connection.prepare(`SELECT ${AuthService.KEY_COLUMNS} FROM api_keys k LEFT JOIN users u ON u.id = k.owner_user_id WHERE k.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new AppError(404, "API_KEY_NOT_FOUND", "Clave no encontrada");
    return AuthService.toKey(row);
  }

  listKeys(ownerId?: string): KeyRecord[] {
    return (this.db.connection.prepare(`SELECT ${AuthService.KEY_COLUMNS} FROM api_keys k LEFT JOIN users u ON u.id = k.owner_user_id ${ownerId ? "WHERE k.owner_user_id = ?" : ""} ORDER BY k.created_at DESC`).all(...(ownerId ? [ownerId] : [])) as Array<Record<string, unknown>>).map(AuthService.toKey);
  }

  /** Who may see and revoke a key: its owner, and whoever manages the owner (or, for keys without an owner, the key's grants). */
  canManageKey(actor: Identity, key: KeyRecord): boolean {
    const self = actor.kind === "user" ? actor.id : actor.ownerId;
    if (key.ownerId && key.ownerId === self) return true;
    if (actor.role !== "admin" && actor.role !== "org-admin") return false;
    if (!key.ownerId) return this.canManageGrantee(actor, key);
    const owner = this.db.connection.prepare("SELECT * FROM users WHERE id = ?").get(key.ownerId) as UserRow | undefined;
    return owner ? this.canManageGrantee(actor, toUser(owner)) : actor.role === "admin";
  }

  revokeKey(id: string): void {
    const result = this.db.connection.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(new Date().toISOString(), id);
    if (!result.changes) throw new AppError(404, "API_KEY_NOT_FOUND", `API key no encontrada o ya revocada: ${id}`);
  }

  // ---------------------------------------------------------------- users

  userCount(): number { return (this.db.connection.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n; }

  activeAdminCount(): number { return (this.db.connection.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL").get() as { n: number }).n; }

  listUsers(): UserRecord[] { return (this.db.connection.prepare("SELECT * FROM users ORDER BY username").all() as UserRow[]).map(toUser); }

  getUser(id: string): UserRecord {
    const row = this.db.connection.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    if (!row) throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado");
    return toUser(row);
  }

  async createUser(input: UserInput): Promise<UserRecord> {
    const username = this.normalizeUsername(input.username);
    invariant(ROLES.includes(input.role), 400, "INVALID_ROLE", "Rol inválido");
    this.assertPassword(input.password, username);
    const displayName = (input.displayName ?? "").trim().slice(0, 200) || username;
    const hash = await hashPassword(input.password);
    const id = randomUUID(), now = new Date().toISOString();
    try {
      this.db.connection.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, project_ids_json, organization_ids_json, package_scopes_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, username, displayName, hash, input.role, JSON.stringify(input.projectIds ?? []), JSON.stringify(input.organizationIds ?? []), JSON.stringify(input.packageScopes ?? []), now, now);
    } catch (error) {
      if (String((error as Error).message).includes("UNIQUE")) throw new AppError(409, "USERNAME_TAKEN", "Ese nombre de usuario ya existe");
      throw error;
    }
    return this.getUser(id);
  }

  /** First-run: creates the first admin only while no user exists (atomic check-and-insert). */
  async createFirstAdmin(input: Omit<UserInput, "role">): Promise<UserRecord> {
    invariant(this.userCount() === 0, 409, "SETUP_COMPLETED", "El servidor ya tiene usuarios. Inicia sesión.");
    const username = this.normalizeUsername(input.username);
    this.assertPassword(input.password, username);
    const hash = await hashPassword(input.password);
    const id = randomUUID(), now = new Date().toISOString();
    const inserted = this.db.connection.transaction(() => {
      if (this.userCount() > 0) return false;
      this.db.connection.prepare(`INSERT INTO users (id, username, display_name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', ?, ?)`)
        .run(id, username, (input.displayName ?? "").trim().slice(0, 200) || username, hash, now, now);
      return true;
    })();
    invariant(inserted, 409, "SETUP_COMPLETED", "El servidor ya tiene usuarios. Inicia sesión.");
    return this.getUser(id);
  }

  /** Seeds the first admin from MODAI_ADMIN_USERNAME / MODAI_ADMIN_PASSWORD; ignored once users exist. */
  async seedAdmin(username?: string, password?: string): Promise<UserRecord | undefined> {
    if (!username?.trim() || !password || this.userCount() > 0) return undefined;
    return this.createFirstAdmin({ username, password, displayName: username });
  }

  async updateUser(actor: Identity, id: string, input: UserUpdate): Promise<UserRecord> {
    const current = this.getUser(id);
    const self = actor.kind === "user" && actor.id === id;
    if (input.role !== undefined) invariant(ROLES.includes(input.role), 400, "INVALID_ROLE", "Rol inválido");
    if (self && input.role !== undefined && input.role !== current.role) throw new AppError(409, "SELF_ROLE_CHANGE", "No puedes cambiar tu propio rol");
    if (self && input.disabled) throw new AppError(409, "SELF_DISABLE", "No puedes desactivar tu propia cuenta");
    const losesAdmin = current.role === "admin" && !current.disabledAt && ((input.role !== undefined && input.role !== "admin") || input.disabled === true);
    if (losesAdmin && this.activeAdminCount() <= 1) throw new AppError(409, "LAST_ADMIN", "Debe quedar al menos un administrador activo");
    const fields: string[] = [], values: unknown[] = [];
    if (input.displayName !== undefined) { invariant(input.displayName.trim().length > 0, 400, "INVALID_INPUT", "El nombre visible no puede estar vacío"); fields.push("display_name = ?"); values.push(input.displayName.trim().slice(0, 200)); }
    if (input.role !== undefined) { fields.push("role = ?"); values.push(input.role); }
    if (input.projectIds !== undefined) { fields.push("project_ids_json = ?"); values.push(JSON.stringify(input.projectIds)); }
    if (input.organizationIds !== undefined) { fields.push("organization_ids_json = ?"); values.push(JSON.stringify(input.organizationIds)); }
    if (input.packageScopes !== undefined) { fields.push("package_scopes_json = ?"); values.push(JSON.stringify(input.packageScopes)); }
    if (input.disabled !== undefined) { fields.push("disabled_at = ?"); values.push(input.disabled ? (current.disabledAt ?? new Date().toISOString()) : null); }
    if (input.password !== undefined) { this.assertPassword(input.password, current.username); fields.push("password_hash = ?"); values.push(await hashPassword(input.password)); }
    if (fields.length) {
      fields.push("updated_at = ?"); values.push(new Date().toISOString());
      this.db.connection.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
    }
    // A disabled account or an admin-reset password must not keep live sessions.
    if (input.disabled || input.password !== undefined) this.db.connection.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    return this.getUser(id);
  }

  deleteUser(actor: Identity, id: string): UserRecord {
    const current = this.getUser(id);
    if (actor.kind === "user" && actor.id === id) throw new AppError(409, "SELF_DELETE", "No puedes eliminar tu propia cuenta");
    if (current.role === "admin" && !current.disabledAt && this.activeAdminCount() <= 1) throw new AppError(409, "LAST_ADMIN", "Debe quedar al menos un administrador activo");
    this.db.connection.transaction(() => {
      // Keys are revoked, not deleted: their audit trail keeps pointing at something.
      this.db.connection.prepare("UPDATE api_keys SET revoked_at = ? WHERE owner_user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), id);
      this.db.connection.prepare("DELETE FROM users WHERE id = ?").run(id);
    })();
    return current;
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string, keepSessionToken?: string): Promise<void> {
    const row = this.db.connection.prepare("SELECT * FROM users WHERE id = ? AND disabled_at IS NULL").get(userId) as UserRow | undefined;
    if (!row) throw new AppError(401, "UNAUTHORIZED", "Sesión inválida");
    if (typeof currentPassword !== "string" || !(await verifyPassword(currentPassword, row.password_hash))) throw new AppError(400, "INVALID_PASSWORD", "La contraseña actual no es correcta");
    invariant(currentPassword !== newPassword, 400, "INVALID_PASSWORD", "La nueva contraseña debe ser distinta de la actual");
    this.assertPassword(newPassword, row.username);
    this.db.connection.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(await hashPassword(newPassword), new Date().toISOString(), userId);
    // Sign out every other device.
    this.db.connection.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, keepSessionToken ? sha256(keepSessionToken) : "");
  }

  // ------------------------------------------------------------- sessions

  /**
   * Verifies credentials. Always spends the same scrypt work and returns the same result for unknown users,
   * wrong passwords and disabled accounts. Repeated failures lock the username for a while.
   */
  async verifyLogin(usernameInput: unknown, password: unknown): Promise<{ user?: UserRecord; locked: boolean }> {
    const username = typeof usernameInput === "string" ? usernameInput.trim().toLowerCase().slice(0, 64) : "";
    const pass = typeof password === "string" ? password.slice(0, MAX_PASSWORD_LENGTH) : "";
    const now = Date.now(), entry = this.failures.get(username);
    const row = username ? this.db.connection.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined : undefined;
    decoyHash ??= hashPassword(randomBytes(18).toString("base64url"));
    const valid = await verifyPassword(pass, row?.password_hash ?? await decoyHash);
    if (entry && entry.lockedUntil > now) return { locked: true };
    if (!row || !valid || row.disabled_at || !pass) {
      const failure = entry && now - entry.first < 15 * 60_000 ? entry : { count: 0, first: now, lockedUntil: 0 };
      failure.count += 1;
      if (failure.count >= 5) failure.lockedUntil = now + 15 * 60_000;
      if (this.failures.size > 10_000) this.failures.clear();
      this.failures.set(username, failure);
      return { locked: false };
    }
    this.failures.delete(username);
    return { user: toUser(row), locked: false };
  }

  createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}): CreatedSession {
    const token = randomBytes(32).toString("base64url"), now = Date.now();
    const expiresAt = new Date(Math.min(now + this.idleMs, now + this.absoluteMs)).toISOString();
    const absoluteExpiresAt = new Date(now + this.absoluteMs).toISOString(), iso = new Date(now).toISOString();
    this.db.connection.prepare("DELETE FROM sessions WHERE expires_at < ? OR absolute_expires_at < ?").run(iso, iso);
    this.db.connection.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, absolute_expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sha256(token), userId, iso, iso, expiresAt, absoluteExpiresAt, meta.userAgent?.slice(0, 300) ?? null, meta.ip?.slice(0, 100) ?? null);
    this.db.connection.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(iso, userId);
    return { token, expiresAt, absoluteExpiresAt, maxAgeSeconds: Math.floor(this.absoluteMs / 1000) };
  }

  /** Resolves a session cookie into the same Identity used by API keys; extends the idle window (sliding). */
  authenticateSession(token?: string): Identity | undefined {
    if (!token || token.length > 200) return undefined;
    const hash = sha256(token);
    const row = this.db.connection.prepare(`SELECT s.expires_at, s.absolute_expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
      .get(hash) as (UserRow & { expires_at: string; absolute_expires_at: string; last_seen_at: string }) | undefined;
    if (!row) return undefined;
    const now = Date.now();
    if (row.disabled_at || Date.parse(row.expires_at) <= now || Date.parse(row.absolute_expires_at) <= now) {
      this.db.connection.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return undefined;
    }
    if (now - Date.parse(row.last_seen_at) > 60_000) {
      const expiresAt = new Date(Math.min(now + this.idleMs, Date.parse(row.absolute_expires_at))).toISOString();
      this.db.connection.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?").run(new Date(now).toISOString(), expiresAt, hash);
    }
    const user = toUser(row);
    return { id: user.id, label: user.username, role: user.role, projectIds: user.projectIds, organizationIds: user.organizationIds, packageScopes: user.packageScopes, kind: "user" };
  }

  deleteSession(token?: string): void { if (token) this.db.connection.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token)); }

  private normalizeUsername(value: unknown): string {
    const username = typeof value === "string" ? value.trim().toLowerCase() : "";
    invariant(USERNAME_PATTERN.test(username), 400, "INVALID_USERNAME", "El usuario debe tener de 3 a 64 caracteres: letras, números, punto, guion o guion bajo");
    return username;
  }

  private assertPassword(password: unknown, username: string): asserts password is string {
    invariant(typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH, 400, "WEAK_PASSWORD", `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    invariant(password.length <= MAX_PASSWORD_LENGTH, 400, "WEAK_PASSWORD", `La contraseña admite hasta ${MAX_PASSWORD_LENGTH} caracteres`);
    invariant(password.toLowerCase() !== username.toLowerCase(), 400, "WEAK_PASSWORD", "La contraseña no puede ser igual al usuario");
  }
}
