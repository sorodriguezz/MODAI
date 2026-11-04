import { AppError, invariant } from "@modai/contracts/errors";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { AuthorizationService } from "../auth/authorization.service.js";
import { type Identity, namespaceOf } from "../auth/identity.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
import { NamespacesRepository } from "./namespaces.repository.js";

export type NamespaceVisibility = "internal" | "restricted";
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
type NamespaceInput = { organizationId?: string | null; description?: string; visibility?: NamespaceVisibility };

const NAMESPACE_PATTERN = /^@[a-z0-9][a-z0-9._-]{0,63}$/;

export class NamespacesService {
  private readonly namespaces: NamespacesRepository;

  constructor(
    context: DataContext,
    private readonly authz: AuthorizationService,
    private readonly organizations: OrganizationsService,
  ) {
    this.namespaces = new NamespacesRepository(context);
  }

  async listNamespaces(identity: Identity | undefined): Promise<NamespaceRecord[]> {
    const actor = this.authz.require(identity, "reader");
    const canRead = await this.authz.packageReader(actor);
    const publish = await this.authz.publishableNamespaces(actor);
    const counts = new Map<string, number>();
    for (const name of await this.namespaces.activePackageNames())
      counts.set(namespaceOf(name), (counts.get(namespaceOf(name)) ?? 0) + 1);
    return (await this.namespaces.list())
      .filter((row) => canRead(`${row.name}/x`))
      .map((row) => ({
        name: row.name,
        ...(row.organization_id ? { organizationId: row.organization_id } : {}),
        ...(row.organization_name ? { organizationName: row.organization_name } : {}),
        description: row.description,
        visibility: row.visibility as NamespaceVisibility,
        packages: counts.get(row.name) ?? 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        canManage:
          actor.role === "admin" ||
          (actor.role === "org-admin" &&
            Boolean(row.organization_id) &&
            this.authz.administers(actor, row.organization_id)),
        canPublish: publish.all || publish.namespaces.includes(row.name),
      }));
  }

  async getNamespace(identity: Identity | undefined, name: string): Promise<NamespaceRecord> {
    const found = (await this.listNamespaces(identity)).find((item) => item.name === name);
    if (!found) throw new AppError(404, "NAMESPACE_NOT_FOUND", `No existe el namespace ${name}`);
    return found;
  }

  async createNamespace(identity: Identity | undefined, input: NamespaceInput & { name: string }) {
    const actor = this.authz.requireManager(identity);
    const name = input.name.trim().toLowerCase();
    invariant(
      NAMESPACE_PATTERN.test(name),
      400,
      "INVALID_NAMESPACE",
      "El namespace empieza con @ y usa minúsculas, números, punto, guion o guion bajo (por ejemplo @acme-pagos)",
    );
    if (await this.namespaces.exists(name))
      throw new AppError(409, "NAMESPACE_TAKEN", `El namespace ${name} ya existe`);
    await this.assertOwner(actor, input.organizationId ?? undefined);
    const now = new Date().toISOString();
    await this.namespaces.insert({
      name,
      organization_id: input.organizationId ?? null,
      description: (input.description ?? "").trim().slice(0, 1000),
      visibility: input.visibility ?? "internal",
      created_by: actor.id,
      created_at: now,
      updated_at: now,
    });
    return this.getNamespace(actor, name);
  }

  async updateNamespace(identity: Identity | undefined, name: string, input: NamespaceInput) {
    const actor = this.authz.requireManager(identity);
    const current = await this.getNamespace(actor, name);
    if (!current.canManage) throw new AppError(403, "NAMESPACE_FORBIDDEN", "No administras este namespace");
    const organizationId = input.organizationId === undefined ? (current.organizationId ?? null) : input.organizationId;
    if ((organizationId ?? undefined) !== current.organizationId)
      await this.assertOwner(actor, organizationId ?? undefined);
    await this.namespaces.update(name, {
      organization_id: organizationId,
      description: input.description === undefined ? current.description : input.description.trim().slice(0, 1000),
      visibility: input.visibility ?? current.visibility,
      updated_at: new Date().toISOString(),
    });
    return this.getNamespace(actor, name);
  }

  async deleteNamespace(identity: Identity | undefined, name: string): Promise<NamespaceRecord> {
    const actor = this.authz.requireManager(identity);
    const current = await this.getNamespace(actor, name);
    if (!current.canManage) throw new AppError(403, "NAMESPACE_FORBIDDEN", "No administras este namespace");
    const published = await this.namespaces.publishedVersions(name);
    if (published)
      throw new AppError(
        409,
        "NAMESPACE_NOT_EMPTY",
        `El namespace tiene ${published} versión(es) publicadas. Elimínalas antes.`,
      );
    await this.namespaces.delete(name);
    return current;
  }

  async ensureNamespace(packageName: string, actor: Identity): Promise<void> {
    const now = new Date().toISOString();
    await this.namespaces.insertIfMissing({
      name: namespaceOf(packageName),
      organization_id: null,
      description: "",
      visibility: "internal",
      created_by: actor.id,
      created_at: now,
      updated_at: now,
    });
  }

  async requireNamespaceExists(templateName: string): Promise<void> {
    const scope = namespaceOf(templateName);
    if (!(await this.namespaces.exists(scope)))
      throw new AppError(
        404,
        "NAMESPACE_NOT_FOUND",
        `El namespace ${scope} no existe. Créalo antes en el menú Namespaces (o con POST /api/v1/namespaces).`,
      );
  }

  private async assertOwner(actor: Identity, organizationId?: string): Promise<void> {
    if (organizationId) await this.organizations.requireOrganizationExists(organizationId);
    if (actor.role === "admin") return;
    if (!organizationId) throw new AppError(400, "ORGANIZATION_REQUIRED", "Elige la organización dueña del namespace");
    if (!this.authz.administers(actor, organizationId))
      throw new AppError(403, "ORGANIZATION_FORBIDDEN", "No administras esa organización");
  }
}
