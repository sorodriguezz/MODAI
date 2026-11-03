import { randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import type { AuthService, Identity } from "./auth-service.js";
import type { Database } from "./database.js";

export type NamespaceVisibility = "internal" | "restricted";
export interface OrganizationRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt?: string;
  projects: number;
  namespaces: number;
  members: number;
  canManage: boolean;
}
export interface NamespaceRecord {
  name: string;
  organizationId?: string;
  organizationName?: string;
  description: string;
  visibility: NamespaceVisibility;
  packages: number;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  canPublish: boolean;
}

const NAMESPACE_PATTERN = /^@[a-z0-9][a-z0-9._-]{0,63}$/;

type OrganizationRow = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string | null;
  projects: number;
  namespaces: number;
};
type NamespaceRow = {
  name: string;
  organization_id: string | null;
  organization_name: string | null;
  description: string;
  visibility: NamespaceVisibility;
  created_at: string;
  updated_at: string;
  packages: number;
};

/**
 * Organizations and namespaces: the top two levels of the hierarchy organization → project → namespace → package.
 * Global admins manage everything; organization admins manage the organizations in their grants and what they own.
 */
export class DirectoryService {
  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
  ) {}

  // ---------------------------------------------------------- organizations

  listOrganizations(identity: Identity | undefined): OrganizationRecord[] {
    const actor = this.auth.require(identity, "reader");
    const rows = this.db.connection
      .prepare(`SELECT o.id, o.name, o.description, o.created_at, o.updated_at,
      (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id) AS projects,
      (SELECT COUNT(*) FROM namespaces n WHERE n.organization_id = o.id) AS namespaces
      FROM organizations o ORDER BY o.name COLLATE NOCASE`)
      .all() as OrganizationRow[];
    const members = this.memberCounts();
    return rows
      .filter((row) => actor.role === "admin" || actor.organizationIds.includes(row.id))
      .map((row) => this.toOrganization(row, actor, members.get(row.id) ?? 0));
  }

  getOrganization(identity: Identity | undefined, id: string): OrganizationRecord {
    const found = this.listOrganizations(identity).find((item) => item.id === id);
    if (!found) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organización no encontrada");
    return found;
  }

  createOrganization(
    identity: Identity | undefined,
    input: { name: string; description?: string },
  ): OrganizationRecord {
    const actor = this.auth.require(identity, "admin");
    const name = this.cleanName(input.name);
    this.assertUniqueName(name);
    const id = randomUUID(),
      now = new Date().toISOString();
    this.db.connection
      .prepare("INSERT INTO organizations (id, name, created_at, description, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, name, now, (input.description ?? "").trim().slice(0, 1000), now);
    return this.getOrganization(actor, id);
  }

  updateOrganization(
    identity: Identity | undefined,
    id: string,
    input: { name?: string; description?: string },
  ): OrganizationRecord {
    const actor = this.auth.requireManager(identity);
    const current = this.getOrganization(actor, id);
    if (!current.canManage) throw new AppError(403, "ORGANIZATION_FORBIDDEN", "No administras esta organización");
    const name = input.name === undefined ? current.name : this.cleanName(input.name);
    if (name.toLocaleLowerCase() !== current.name.toLocaleLowerCase()) this.assertUniqueName(name);
    const description = input.description === undefined ? current.description : input.description.trim().slice(0, 1000);
    this.db.connection
      .prepare("UPDATE organizations SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(name, description, new Date().toISOString(), id);
    return this.getOrganization(actor, id);
  }

  /** Only empty organizations can be deleted: move or delete their projects and namespaces first. */
  deleteOrganization(identity: Identity | undefined, id: string): OrganizationRecord {
    const actor = this.auth.require(identity, "admin");
    const current = this.getOrganization(actor, id);
    if (current.projects || current.namespaces)
      throw new AppError(
        409,
        "ORGANIZATION_NOT_EMPTY",
        `La organización tiene ${current.projects} proyecto(s) y ${current.namespaces} namespace(s). Muévelos o elimínalos antes.`,
      );
    this.db.connection.transaction(() => {
      for (const table of ["api_keys", "users"]) {
        this.db.connection
          .prepare(`UPDATE ${table} SET organization_ids_json = (SELECT json_group_array(value) FROM json_each(${table}.organization_ids_json) WHERE value != ?)
          WHERE EXISTS (SELECT 1 FROM json_each(${table}.organization_ids_json) WHERE value = ?)`)
          .run(id, id);
      }
      this.db.connection.prepare("UPDATE memories SET organization_id = NULL WHERE organization_id = ?").run(id);
      this.db.connection.prepare("DELETE FROM organizations WHERE id = ?").run(id);
    })();
    return current;
  }

  // ------------------------------------------------------------- namespaces

  listNamespaces(identity: Identity | undefined): NamespaceRecord[] {
    const actor = this.auth.require(identity, "reader");
    const canRead = this.auth.packageReader(actor);
    return (
      this.db.connection
        .prepare(`SELECT n.name, n.organization_id, o.name AS organization_name, n.description, n.visibility, n.created_at, n.updated_at,
      (SELECT COUNT(DISTINCT p.name) FROM packages p WHERE substr(p.name, 1, length(n.name) + 1) = n.name || '/' AND p.status <> 'yanked') AS packages
      FROM namespaces n LEFT JOIN organizations o ON o.id = n.organization_id ORDER BY n.name`)
        .all() as NamespaceRow[]
    )
      .filter((row) => canRead(`${row.name}/x`))
      .map((row) => this.toNamespace(row, actor));
  }

  getNamespace(identity: Identity | undefined, name: string): NamespaceRecord {
    const found = this.listNamespaces(identity).find((item) => item.name === name);
    if (!found) throw new AppError(404, "NAMESPACE_NOT_FOUND", `No existe el namespace ${name}`);
    return found;
  }

  createNamespace(
    identity: Identity | undefined,
    input: { name: string; organizationId?: string; description?: string; visibility?: NamespaceVisibility },
  ): NamespaceRecord {
    const actor = this.auth.requireManager(identity);
    const name = input.name.trim().toLowerCase();
    invariant(
      NAMESPACE_PATTERN.test(name),
      400,
      "INVALID_NAMESPACE",
      "El namespace empieza con @ y usa minúsculas, números, punto, guion o guion bajo (por ejemplo @acme-pagos)",
    );
    if (this.db.connection.prepare("SELECT 1 FROM namespaces WHERE name = ?").get(name))
      throw new AppError(409, "NAMESPACE_TAKEN", `El namespace ${name} ya existe`);
    this.assertOwner(actor, input.organizationId);
    const now = new Date().toISOString();
    this.db.connection
      .prepare(
        "INSERT INTO namespaces (name, organization_id, description, visibility, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        name,
        input.organizationId ?? null,
        (input.description ?? "").trim().slice(0, 1000),
        input.visibility ?? "internal",
        actor.id,
        now,
        now,
      );
    return this.getNamespace(actor, name);
  }

  updateNamespace(
    identity: Identity | undefined,
    name: string,
    input: { organizationId?: string | null; description?: string; visibility?: NamespaceVisibility },
  ): NamespaceRecord {
    const actor = this.auth.requireManager(identity);
    const current = this.getNamespace(actor, name);
    if (!current.canManage) throw new AppError(403, "NAMESPACE_FORBIDDEN", "No administras este namespace");
    const organizationId = input.organizationId === undefined ? (current.organizationId ?? null) : input.organizationId;
    if ((organizationId ?? undefined) !== current.organizationId) this.assertOwner(actor, organizationId ?? undefined);
    this.db.connection
      .prepare(
        "UPDATE namespaces SET organization_id = ?, description = ?, visibility = ?, updated_at = ? WHERE name = ?",
      )
      .run(
        organizationId,
        input.description === undefined ? current.description : input.description.trim().slice(0, 1000),
        input.visibility ?? current.visibility,
        new Date().toISOString(),
        name,
      );
    return this.getNamespace(actor, name);
  }

  /** Namespaces with published packages stay: yank or delete the packages first. Grants to it are removed. */
  deleteNamespace(identity: Identity | undefined, name: string): NamespaceRecord {
    const actor = this.auth.requireManager(identity);
    const current = this.getNamespace(actor, name);
    if (!current.canManage) throw new AppError(403, "NAMESPACE_FORBIDDEN", "No administras este namespace");
    const published = this.db.connection
      .prepare("SELECT COUNT(*) AS n FROM packages WHERE substr(name, 1, length(?) + 1) = ? || '/'")
      .get(name, name) as { n: number };
    if (published.n)
      throw new AppError(
        409,
        "NAMESPACE_NOT_EMPTY",
        `El namespace tiene ${published.n} versión(es) publicadas. Elimínalas antes.`,
      );
    this.db.connection.transaction(() => {
      for (const table of ["api_keys", "users"]) {
        this.db.connection
          .prepare(`UPDATE ${table} SET package_scopes_json = (SELECT json_group_array(value) FROM json_each(${table}.package_scopes_json) WHERE value != ?)
          WHERE EXISTS (SELECT 1 FROM json_each(${table}.package_scopes_json) WHERE value = ?)`)
          .run(name, name);
      }
      this.db.connection.prepare("DELETE FROM namespaces WHERE name = ?").run(name);
    })();
    return current;
  }

  // ---------------------------------------------------------------- helpers

  private assertOwner(actor: Identity, organizationId?: string): void {
    if (organizationId) this.auth.requireOrganizationExists(organizationId);
    if (actor.role === "admin") return;
    if (!organizationId) throw new AppError(400, "ORGANIZATION_REQUIRED", "Elige la organización dueña del namespace");
    if (!this.auth.administers(actor, organizationId))
      throw new AppError(403, "ORGANIZATION_FORBIDDEN", "No administras esa organización");
  }

  private memberCounts(): Map<string, number> {
    const rows = this.db.connection
      .prepare(`SELECT value AS id, COUNT(*) AS n FROM (
      SELECT value FROM users, json_each(users.organization_ids_json) WHERE users.disabled_at IS NULL
      UNION ALL SELECT value FROM api_keys, json_each(api_keys.organization_ids_json) WHERE api_keys.revoked_at IS NULL) GROUP BY value`)
      .all() as Array<{ id: string; n: number }>;
    return new Map(rows.map((row) => [row.id, row.n]));
  }

  private toOrganization(row: OrganizationRow, actor: Identity, members: number): OrganizationRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdAt: row.created_at,
      ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
      projects: row.projects,
      namespaces: row.namespaces,
      members,
      canManage: this.auth.administers(actor, row.id) && ["admin", "org-admin"].includes(actor.role),
    };
  }

  private toNamespace(row: NamespaceRow, actor: Identity): NamespaceRecord {
    const publish = this.auth.publishableNamespaces(actor);
    const canManage =
      actor.role === "admin" ||
      (actor.role === "org-admin" && Boolean(row.organization_id) && this.auth.administers(actor, row.organization_id));
    return {
      name: row.name,
      ...(row.organization_id ? { organizationId: row.organization_id } : {}),
      ...(row.organization_name ? { organizationName: row.organization_name } : {}),
      description: row.description,
      visibility: row.visibility,
      packages: row.packages,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canManage,
      canPublish: publish.all || publish.namespaces.includes(row.name),
    };
  }

  private cleanName(value: string): string {
    const name = String(value ?? "").trim();
    invariant(
      name.length > 0 && name.length <= 200,
      400,
      "INVALID_INPUT",
      "El nombre de la organización es obligatorio (máximo 200 caracteres)",
    );
    return name;
  }

  private assertUniqueName(name: string): void {
    if (this.db.connection.prepare("SELECT 1 FROM organizations WHERE name = ? COLLATE NOCASE").get(name))
      throw new AppError(409, "ORGANIZATION_TAKEN", `Ya existe una organización llamada «${name}»`);
  }
}
