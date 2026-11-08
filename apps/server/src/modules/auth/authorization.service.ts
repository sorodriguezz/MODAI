import { AppError } from "@modai/contracts/errors";
import type { DataContext } from "../../infrastructure/database/database.js";
import { AuthorizationRepository } from "./authorization.repository.js";
import { type Grantee, type Identity, type NamespaceScope, namespaceOf, type Role } from "./identity.js";
import { allNamespaces } from "./namespace-access.js";

export type PackageReader = (packageName: string) => boolean;

export class AuthorizationService {
  readonly repository: AuthorizationRepository;

  constructor(context: DataContext) {
    this.repository = new AuthorizationRepository(context);
  }

  require(identity: Identity | undefined, minimum: Role): Identity {
    if (!identity) throw new AppError(401, "UNAUTHORIZED", "Token inválido o ausente");
    if (!this.satisfies(identity.role, minimum)) throw new AppError(403, "FORBIDDEN", `Se requiere rol ${minimum}`);
    return identity;
  }

  satisfies(role: Role, minimum: Role): boolean {
    if (role === "admin" || minimum === "reader" || role === minimum) return true;
    return role === "org-admin" && minimum === "publisher";
  }

  managedOrganizations(actor: Identity): string[] | undefined {
    if (actor.role === "admin") return undefined;
    return actor.role === "org-admin" ? actor.organizationIds : [];
  }

  administers(actor: Identity, organizationId: string | null | undefined): boolean {
    const managed = this.managedOrganizations(actor);
    return managed === undefined || (Boolean(organizationId) && managed.includes(organizationId!));
  }

  requireManager(identity: Identity | undefined): Identity {
    const actor = this.require(identity, "reader");
    if (actor.role !== "admin" && actor.role !== "org-admin")
      throw new AppError(403, "FORBIDDEN", "Se requiere administración global o de organización");
    return actor;
  }

  canManageGrantee(actor: Identity, target: Grantee): boolean {
    const managed = this.managedOrganizations(actor);
    if (managed === undefined) return true;
    return (
      target.role !== "admin" &&
      target.organizationIds.length > 0 &&
      target.organizationIds.every((id) => managed.includes(id))
    );
  }

  seesProject(actor: Identity, row: { id: string; organizationId?: string | null; createdBy: string }): boolean {
    return (
      actor.role === "admin" ||
      row.createdBy === actor.id ||
      row.createdBy === actor.personalOwnerId ||
      actor.projectIds.includes(row.id) ||
      (actor.role === "org-admin" && this.administers(actor, row.organizationId))
    );
  }

  requireOrganization(identity: Identity | undefined, organizationId?: string): void {
    const actor = this.require(identity, "reader");
    if (!organizationId || (actor.role !== "admin" && !actor.organizationIds.includes(organizationId)))
      throw new AppError(403, "ORGANIZATION_FORBIDDEN", "La clave no tiene acceso a esta organización");
  }

  async packageReader(identity: Identity | undefined): Promise<PackageReader> {
    const actor = this.require(identity, "reader");
    if (allNamespaces(actor)) return () => true;
    const names = new Set((await this.repository.readableNamespaces(actor)).map((row) => row.name));
    return (packageName) => names.has(namespaceOf(packageName));
  }

  packageVisibility(identity: Identity | undefined) {
    return this.repository.packageVisibility(this.require(identity, "reader"));
  }

  async requireReadPackage(identity: Identity | undefined, packageName: string): Promise<void> {
    if (!(await this.packageReader(identity))(packageName))
      throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${packageName}`);
  }

  async publishableNamespaces(actor: Identity): Promise<NamespaceScope> {
    if (!this.satisfies(actor.role, "publisher")) return { all: false, namespaces: [] };
    if (actor.role === "admin" || actor.packageScopes.includes("*")) return { all: true, namespaces: [] };
    const owned = (await this.managedNamespaces(actor)).namespaces;
    return { all: false, namespaces: [...new Set([...actor.packageScopes, ...owned])].sort() };
  }

  async managedNamespaces(actor: Identity): Promise<NamespaceScope> {
    if (actor.role === "admin") return { all: true, namespaces: [] };
    const personal = this.satisfies(actor.role, "publisher")
      ? await this.repository.namespacesOfUser(actor.personalOwnerId)
      : [];
    const organization =
      actor.role === "org-admin" ? await this.repository.namespacesOfOrganizations(actor.organizationIds) : [];
    return { all: false, namespaces: [...new Set([...personal, ...organization])].sort() };
  }

  async requireManagePackage(identity: Identity | undefined, packageName: string): Promise<Identity> {
    const actor = this.require(identity, "publisher");
    const managed = await this.managedNamespaces(actor);
    if (!managed.all && !managed.namespaces.includes(namespaceOf(packageName)))
      throw new AppError(403, "PACKAGE_FORBIDDEN", `No administras el namespace ${namespaceOf(packageName)}`);
    return actor;
  }

  async requirePublish(identity: Identity | undefined, packageName: string): Promise<void> {
    const actor = this.require(identity, "publisher");
    const allowed = await this.publishableNamespaces(actor);
    const scope = namespaceOf(packageName);
    if (!(await this.repository.namespaceExists(scope)))
      throw new AppError(
        404,
        "NAMESPACE_NOT_FOUND",
        `El namespace ${scope} no existe. Créalo antes con su organización o usuario dueño (menú Namespaces o POST /api/v1/namespaces).`,
      );
    if (!allowed.all && !allowed.namespaces.includes(scope))
      throw new AppError(
        403,
        "PACKAGE_FORBIDDEN",
        `La clave no puede publicar en el namespace ${scope}. Pide acceso a la administración de su organización.`,
      );
  }

  async requireWriteKnowledge(identity: Identity | undefined, packageName?: string | null): Promise<void> {
    if (packageName) return this.requirePublish(identity, packageName);
    const actor = this.require(identity, "publisher");
    if (actor.role !== "admin")
      throw new AppError(
        403,
        "KNOWLEDGE_FORBIDDEN",
        "El conocimiento compartido con todo el servidor lo escribe la administración global. Asócialo a un paquete de tu namespace con packageName.",
      );
  }
}
