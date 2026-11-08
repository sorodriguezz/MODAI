import { invariant } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import type {
  BindingTarget,
  CapabilityBinding,
  CapabilityBindingInput,
  EffectiveProfile,
  ProjectRecord,
} from "@modai/contracts/types";
import semver from "semver";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { AuthorizationService } from "../auth/authorization.service.js";
import type { Identity } from "../auth/identity.js";
import type { OrganizationsService } from "../organizations/organizations.service.js";
import type { PackagesService } from "../packages/packages.service.js";
import type { ProjectsService } from "../projects/projects.service.js";
import { effectiveBindings } from "./binding-precedence.js";
import { ProfileRepository } from "./profile.repository.js";
import type { TeamsService } from "./teams.service.js";

export class ProfilesService {
  private readonly bindings: ProfileRepository;

  constructor(
    context: DataContext,
    private readonly authz: AuthorizationService,
    private readonly projects: ProjectsService,
    private readonly organizations: OrganizationsService,
    private readonly teams: TeamsService,
    private readonly packages: PackagesService,
  ) {
    this.bindings = new ProfileRepository(context);
  }

  private async manage(identity: Identity | undefined, target: BindingTarget): Promise<Identity> {
    const actor = this.authz.requireManager(identity);
    if (target.scope === "organization") {
      this.teams.requireOrganizationManager(actor, target.id);
      await this.organizations.requireOrganizationExists(target.id);
    } else if (target.scope === "project") {
      const project = await this.projects.requireProject(actor, target.id);
      invariant(
        this.authz.administers(actor, project.organizationId),
        403,
        "PROJECT_FORBIDDEN",
        "No administras este proyecto",
      );
    } else {
      await this.teams.requireManagedTeam(actor, target.id);
    }
    return actor;
  }

  async list(identity: Identity | undefined, target: BindingTarget): Promise<CapabilityBinding[]> {
    await this.manage(identity, target);
    return this.bindings.list(target);
  }

  async set(
    identity: Identity | undefined,
    target: BindingTarget,
    input: CapabilityBindingInput,
  ): Promise<CapabilityBinding> {
    const actor = await this.manage(identity, target);
    const now = new Date().toISOString();
    invariant(semver.validRange(input.range), 400, "INVALID_RANGE", "Indica una versión o rango SemVer válido");
    invariant(
      !input.exception || input.exception.reviewAt > now,
      400,
      "INVALID_REVIEW_DATE",
      "La revisión debe ser futura",
    );
    await this.authz.requireReadPackage(actor, input.packageName);
    const item = await this.packages.get(input.packageName);
    invariant(
      item.manifest.kind !== "Template",
      400,
      "TEMPLATE_NOT_INSTALLABLE",
      "Asigna un paquete instalable o un Profile",
    );
    const binding = {
      ...input,
      target,
      slot: input.slot ?? input.packageName,
      required: input.required ?? false,
      approvedBy: actor.id,
      updatedAt: now,
    };
    await this.bindings.set(binding);
    return binding;
  }

  async delete(identity: Identity | undefined, target: BindingTarget, slot: string): Promise<void> {
    await this.manage(identity, target);
    await this.bindings.delete(target, slot);
  }

  async resolve(actor: Identity, project: ProjectRecord, platform?: NodeJS.Platform): Promise<EffectiveProfile> {
    const organizationId = project.organizationId ?? undefined;
    const member = organizationId && actor.organizationIds.includes(organizationId) ? actor.personalOwnerId : undefined;
    const [items, visible] = await Promise.all([
      this.bindings.applicable(project.id, organizationId, member),
      this.authz.packageReader(actor),
    ]);
    const bindings = effectiveBindings(items, visible, new Date().toISOString());
    const selection = bindings.length
      ? await this.packages.resolveSelection(
          {
            packages: bindings.map((item) => ({ name: item.packageName, range: item.range })),
          },
          { visible, platform },
        )
      : { packages: [], capabilities: {} };
    const payload = {
      schemaVersion: 1 as const,
      projectId: project.id,
      ...(organizationId ? { organizationId } : {}),
      bindings,
      packages: selection.packages.map(({ name, version, artifactId }) => ({ name, version, artifactId })),
      capabilities: selection.capabilities,
    };
    return { ...payload, digest: sha256(JSON.stringify(payload)) };
  }
}
