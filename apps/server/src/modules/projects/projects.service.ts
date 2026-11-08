import { randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import type { ProjectRecord } from "@modai/contracts/types";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { AuthorizationService } from "../auth/authorization.service.js";
import { type Identity, WRITER_ROLES } from "../auth/identity.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
import { ProjectsRepository } from "./projects.repository.js";

export class ProjectsService {
  private readonly projects: ProjectsRepository;

  constructor(
    context: DataContext,
    private readonly authz: AuthorizationService,
    private readonly organizations: OrganizationsService,
  ) {
    this.projects = new ProjectsRepository(context);
  }

  async requireProject(identity: Identity | undefined, projectId: string, write = false): Promise<ProjectRecord> {
    const actor = this.authz.require(identity, "reader");
    invariant(
      typeof projectId === "string" && projectId.length > 0 && projectId.length <= 200,
      400,
      "INVALID_PROJECT",
      "projectId es obligatorio",
    );
    if (write && !WRITER_ROLES.includes(actor.role))
      throw new AppError(403, "FORBIDDEN", "La clave no permite escribir memoria o tareas");
    const row = await this.projects.findById(projectId);
    if (!row || !this.authz.seesProject(actor, row))
      throw new AppError(403, "PROJECT_FORBIDDEN", "La clave no tiene acceso a este proyecto");
    const { createdBy, ...project } = row;
    return project as ProjectRecord;
  }

  private async creatorOf(id: string): Promise<string> {
    return (await this.projects.findById(id))!.createdBy;
  }

  private async assertMove(actor: Identity, managesCurrent: boolean, organizationId: string | null) {
    if (!managesCurrent)
      throw new AppError(
        403,
        "ORGANIZATION_FORBIDDEN",
        "Solo la administración puede mover un proyecto de organización",
      );
    if (organizationId) {
      await this.organizations.requireOrganizationExists(organizationId);
      if (!this.authz.administers(actor, organizationId))
        throw new AppError(403, "ORGANIZATION_FORBIDDEN", "No administras la organización de destino");
    } else if (actor.role !== "admin")
      throw new AppError(
        403,
        "ORGANIZATION_REQUIRED",
        "Solo la administración global puede dejar un proyecto sin organización",
      );
  }

  async updateProject(
    identity: Identity | undefined,
    id: string,
    input: { name?: string; organizationId?: string | null },
  ): Promise<ProjectRecord> {
    const actor = this.authz.require(identity, "publisher");
    const current = await this.requireProject(actor, id);
    const createdBy = await this.creatorOf(id);
    const managesCurrent =
      actor.role === "admin" || (actor.role === "org-admin" && this.authz.administers(actor, current.organizationId));
    if (!managesCurrent && createdBy !== actor.id && createdBy !== actor.personalOwnerId)
      throw new AppError(
        403,
        "FORBIDDEN",
        "Solo la administración de la organización o quien creó el proyecto puede editarlo",
      );
    const name = input.name?.trim() ?? current.name;
    invariant(name.length > 0 && name.length <= 200, 400, "INVALID_INPUT", "El nombre es obligatorio");
    const previous = current.organizationId ?? null;
    if (input.organizationId !== undefined && input.organizationId !== previous) {
      await this.assertMove(actor, managesCurrent, input.organizationId);
      await this.projects.transfer(id, name, previous, input.organizationId, actor.personalOwnerId ?? actor.id);
    } else await this.projects.rename(id, name);
    return this.requireProject(actor, id);
  }

  async createProject(identity: Identity | undefined, input: { id?: string; name: string; organizationId?: string }) {
    const actor = this.authz.require(identity, "publisher");
    if (actor.role === "org-admin" && !input.organizationId)
      throw new AppError(400, "ORGANIZATION_REQUIRED", "Elige la organización del proyecto");
    if (input.organizationId) {
      await this.organizations.requireOrganizationExists(input.organizationId);
      this.authz.requireOrganization(actor, input.organizationId);
    }
    const id = input.id ?? randomUUID();
    if (await this.projects.findById(id)) return this.requireProject(actor, id);
    const creator = actor.personalOwnerId ?? actor.id;
    const count = await this.projects.countByCreator(creator);
    invariant(actor.role === "admin" || count < 100, 429, "PROJECT_QUOTA", "Límite de proyectos por clave alcanzado");
    const createdAt = new Date().toISOString();
    await this.projects.insert({
      id,
      name: input.name,
      organization_id: input.organizationId ?? null,
      created_by: creator,
      created_at: createdAt,
    });
    return { id, name: input.name, organizationId: input.organizationId, createdAt };
  }

  async deleteProject(identity: Identity | undefined, id: string) {
    const actor = this.authz.require(identity, "reader");
    const project = await this.requireProject(actor, id);
    const createdBy = await this.creatorOf(id);
    const managesIt = actor.role === "org-admin" && this.authz.administers(actor, project.organizationId);
    const isCreator = createdBy === actor.id || createdBy === actor.personalOwnerId;
    if (actor.role !== "admin" && !managesIt && (actor.role === "reader" || !isCreator))
      throw new AppError(403, "FORBIDDEN", "Solo la administración o quien creó el proyecto puede eliminarlo");
    const busy = await this.projects.liveRuns(id, new Date().toISOString());
    if (busy > 0)
      throw new AppError(
        409,
        "PROJECT_BUSY",
        `Hay ${busy} ejecución(es) en curso en este proyecto; cancélalas o espera a que terminen`,
      );
    return { project, ...(await this.projects.deleteCascade(id)) };
  }

  async listProjects(identity: Identity | undefined): Promise<ProjectRecord[]> {
    const actor = this.authz.require(identity, "reader");
    const rows = await this.projects.listWithOrganization();
    return rows
      .filter((row) => this.authz.seesProject(actor, row))
      .map(({ createdBy, organizationName, ...project }) => {
        const manages =
          actor.role === "admin" ||
          (actor.role === "org-admin" && this.authz.administers(actor, project.organizationId));
        const owns = actor.role !== "reader" && (createdBy === actor.id || createdBy === actor.personalOwnerId);
        return {
          ...(project as ProjectRecord),
          ...(organizationName ? { organizationName } : {}),
          canDelete: manages || owns,
          canEdit: manages || owns,
        };
      });
  }
}
