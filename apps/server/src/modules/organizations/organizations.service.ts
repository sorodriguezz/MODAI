import { randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { AuthorizationService } from "../auth/authorization.service.js";
import type { Identity } from "../auth/identity.js";
import { OrganizationsRepository } from "./organizations.repository.js";

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

function cleanName(value: string): string {
  const name = String(value ?? "").trim();
  invariant(
    name.length > 0 && name.length <= 200,
    400,
    "INVALID_INPUT",
    "El nombre de la organización es obligatorio (máximo 200 caracteres)",
  );
  return name;
}

export class OrganizationsService {
  private readonly organizations: OrganizationsRepository;

  constructor(
    context: DataContext,
    private readonly authz: AuthorizationService,
  ) {
    this.organizations = new OrganizationsRepository(context);
  }

  async listOrganizations(identity: Identity | undefined): Promise<OrganizationRecord[]> {
    const actor = this.authz.require(identity, "reader");
    const rows = await this.organizations.list();
    const [projects, namespaces, members] = [
      await this.organizations.projectCounts(),
      await this.organizations.namespaceCounts(),
      await this.organizations.memberCounts(),
    ];
    return rows
      .filter((row) => actor.role === "admin" || actor.organizationIds.includes(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
        projects: projects.get(row.id) ?? 0,
        namespaces: namespaces.get(row.id) ?? 0,
        members: members.get(row.id) ?? 0,
        canManage: this.authz.administers(actor, row.id) && ["admin", "org-admin"].includes(actor.role),
      }));
  }

  async getOrganization(identity: Identity | undefined, id: string): Promise<OrganizationRecord> {
    const found = (await this.listOrganizations(identity)).find((item) => item.id === id);
    if (!found) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organización no encontrada");
    return found;
  }

  async requireOrganizationExists(id: string): Promise<void> {
    if (!(await this.organizations.exists(id)))
      throw new AppError(404, "ORGANIZATION_NOT_FOUND", `No existe la organización ${id}`);
  }

  async createOrganization(identity: Identity | undefined, input: { name: string; description?: string }) {
    const actor = this.authz.require(identity, "admin");
    const name = cleanName(input.name);
    await this.assertUniqueName(name);
    const id = randomUUID(),
      now = new Date().toISOString();
    const description = (input.description ?? "").trim().slice(0, 1000);
    await this.organizations.insert({ id, name, created_at: now, description, updated_at: now });
    return this.getOrganization(actor, id);
  }

  async updateOrganization(identity: Identity | undefined, id: string, input: { name?: string; description?: string }) {
    const actor = this.authz.requireManager(identity);
    const current = await this.getOrganization(actor, id);
    if (!current.canManage) throw new AppError(403, "ORGANIZATION_FORBIDDEN", "No administras esta organización");
    const name = input.name === undefined ? current.name : cleanName(input.name);
    if (name.toLocaleLowerCase() !== current.name.toLocaleLowerCase()) await this.assertUniqueName(name);
    const description = input.description === undefined ? current.description : input.description.trim().slice(0, 1000);
    await this.organizations.update(id, { name, description, updated_at: new Date().toISOString() });
    return this.getOrganization(actor, id);
  }

  async deleteOrganization(identity: Identity | undefined, id: string): Promise<OrganizationRecord> {
    const actor = this.authz.require(identity, "admin");
    const current = await this.getOrganization(actor, id);
    if (current.projects || current.namespaces)
      throw new AppError(
        409,
        "ORGANIZATION_NOT_EMPTY",
        `La organización tiene ${current.projects} proyecto(s) y ${current.namespaces} namespace(s). Muévelos o elimínalos antes.`,
      );
    invariant(
      !(await this.organizations.hasTeams(id)),
      409,
      "ORGANIZATION_NOT_EMPTY",
      "Elimina primero los equipos de la organización",
    );
    await this.organizations.delete(id);
    return current;
  }

  private async assertUniqueName(name: string): Promise<void> {
    if (await this.organizations.nameTaken(name))
      throw new AppError(409, "ORGANIZATION_TAKEN", `Ya existe una organización llamada «${name}»`);
  }
}
