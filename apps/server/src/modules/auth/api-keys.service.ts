import { randomBytes, randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import { sha256, tokensEqual } from "@modai/contracts/security";
import type { DataContext } from "../../infrastructure/database/database.js";
import { type ApiKeyRow, ApiKeysRepository } from "./api-keys.repository.js";
import type { AuthorizationService } from "./authorization.service.js";
import {
  type Identity,
  type KeyGrants,
  type KeyOptions,
  type KeyRecord,
  ROLES,
  type Role,
  userIdentity,
} from "./identity.js";
import { boundToOwner } from "./key-policy.js";
import { toUser, UsersRepository } from "./users.repository.js";

const BOOTSTRAP: Identity = {
  id: "bootstrap",
  label: "bootstrap",
  role: "admin",
  projectIds: [],
  organizationIds: [],
  packageScopes: [],
  kind: "bootstrap",
};

export class ApiKeysService {
  private readonly keys: ApiKeysRepository;
  private readonly users: UsersRepository;

  constructor(
    context: DataContext,
    private readonly authz: AuthorizationService,
    private readonly bootstrapToken?: string,
  ) {
    this.keys = new ApiKeysRepository(context);
    this.users = new UsersRepository(context);
  }

  async configured(): Promise<boolean> {
    if (this.bootstrapToken?.trim()) return true;
    return (await this.keys.hasActiveAdmin()) || (await this.users.activeAdminCount()) > 0;
  }

  async isBootstrapCredential(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    const identity = await this.authenticate(token);
    return identity?.role === "admin" && identity.kind !== "user";
  }

  async authenticate(token?: string): Promise<Identity | undefined> {
    if (!token) return undefined;
    if (this.bootstrapToken && tokensEqual(this.bootstrapToken, token)) return { ...BOOTSTRAP };
    const row = await this.keys.findActiveByTokenHash(sha256(token));
    if (!row) return undefined;
    const identity = await this.keyIdentity(row);
    if (identity) await this.keys.touch(row.id, new Date().toISOString());
    return identity;
  }

  private async keyIdentity(row: ApiKeyRow): Promise<Identity | undefined> {
    const grants = {
      projectIds: JSON.parse(row.project_ids_json),
      organizationIds: JSON.parse(row.organization_ids_json),
      packageScopes: JSON.parse(row.package_scopes_json),
    };
    const role = row.role as Role;
    if (!row.owner_user_id) return { id: row.id, label: row.label, role, ...grants, kind: "api-key" };
    const owner = await this.users.findById(row.owner_user_id);
    if (!owner || owner.disabled_at) return undefined;
    const bound = await boundToOwner(
      this.authz,
      userIdentity(toUser(owner)),
      role,
      grants,
      Boolean(row.inherit_grants),
    );
    if (!bound) return undefined;
    return {
      ...bound,
      id: row.id,
      label: `${owner.username} · ${row.label}`,
      kind: "api-key",
      ownerId: owner.id,
      ownerName: owner.username,
    };
  }

  async createKey(label: string, role: Role, grants: KeyGrants = {}, options: KeyOptions = {}) {
    invariant(ROLES.includes(role), 400, "INVALID_ROLE", "Rol inválido");
    const id = randomUUID(),
      token = `modai_${randomBytes(24).toString("base64url")}`;
    await this.keys.insert({
      id,
      label: label.trim() || "unnamed",
      token_hash: sha256(token),
      role,
      created_at: new Date().toISOString(),
      project_ids_json: JSON.stringify(grants.projectIds ?? []),
      organization_ids_json: JSON.stringify(grants.organizationIds ?? []),
      package_scopes_json: JSON.stringify(grants.packageScopes ?? []),
      owner_user_id: options.ownerId ?? null,
      inherit_grants: options.inherit ? 1 : 0,
    });
    return { ...(await this.getKey(id)), token };
  }

  async updateKeyGrants(id: string, grants: KeyGrants, options: KeyOptions = {}): Promise<void> {
    const current = await this.getKey(id);
    const changed = await this.keys.updateActive(id, {
      project_ids_json: JSON.stringify(grants.projectIds ?? []),
      organization_ids_json: JSON.stringify(grants.organizationIds ?? []),
      package_scopes_json: JSON.stringify(grants.packageScopes ?? []),
      owner_user_id: options.ownerId === undefined ? (current.ownerId ?? null) : options.ownerId,
      inherit_grants: (options.inherit ?? current.inherit) ? 1 : 0,
    });
    invariant(changed, 404, "API_KEY_NOT_FOUND", "Clave no encontrada");
  }

  async getKey(id: string): Promise<KeyRecord> {
    const key = await this.keys.get(id);
    if (!key) throw new AppError(404, "API_KEY_NOT_FOUND", "Clave no encontrada");
    return key;
  }

  listKeys(ownerId?: string): Promise<KeyRecord[]> {
    return this.keys.list(ownerId);
  }

  async canManageKey(actor: Identity, key: KeyRecord): Promise<boolean> {
    const self = actor.kind === "user" ? actor.id : actor.ownerId;
    if (key.ownerId && key.ownerId === self) return true;
    if (actor.role !== "admin" && actor.role !== "org-admin") return false;
    if (!key.ownerId) return this.authz.canManageGrantee(actor, key);
    const owner = await this.users.findById(key.ownerId);
    return owner ? this.authz.canManageGrantee(actor, toUser(owner)) : actor.role === "admin";
  }

  async revokeKey(id: string): Promise<void> {
    const changed = await this.keys.updateActive(id, { revoked_at: new Date().toISOString() });
    if (!changed) throw new AppError(404, "API_KEY_NOT_FOUND", `API key no encontrada o ya revocada: ${id}`);
  }
}
