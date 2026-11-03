import type { SignaturePolicy } from "@modai/contracts/types";
import { HttpClient } from "../http-client.js";
import type { Permissions, Role } from "../types.js";

export class SessionApi extends HttpClient {
  async health(): Promise<{
    status: string;
    version: string;
    apiVersion: number;
    signaturePolicy: SignaturePolicy;
    publicUrl?: string;
  }> {
    return this.request("/health");
  }

  async session(): Promise<{
    label: string;
    role: Role;
    projectIds: string[];
    organizationIds: string[];
    packageScopes: string[];
    permissions: Permissions;
  }> {
    return this.request("/api/v1/session");
  }

  async assertCanPublish(packageName: string): Promise<void> {
    const { label, role, permissions } = await this.session();
    const namespace = packageName.split("/")[0];
    if (permissions.publish.all || permissions.publish.namespaces.includes(namespace)) return;
    const allowed = permissions.publish.namespaces.length
      ? `Puede publicar en: ${permissions.publish.namespaces.join(", ")}.`
      : "No puede publicar en ningún namespace.";
    throw new Error(
      `PACKAGE_FORBIDDEN: La credencial «${label}» (rol ${role}) no puede publicar en ${namespace}. ${allowed} Pide acceso a la administración de la organización dueña del namespace.`,
    );
  }

  async assertCompatible(): Promise<void> {
    const info = await this.health();
    if (info.apiVersion !== 1) throw new Error(`API incompatible: se requiere v1 (servidor ${info.version})`);
  }
}
