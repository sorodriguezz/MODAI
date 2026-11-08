import type { NamespaceOwner, NamespaceRecord, OrganizationRecord } from "../types.js";
import { ProfilesApi } from "./profiles.js";

export class DirectoryApi extends ProfilesApi {
  async createOrganization(name: string, description?: string): Promise<{ id: string; name: string }> {
    return (
      await this.request<{ organization: { id: string; name: string } }>("/api/v1/organizations", {
        method: "POST",
        body: JSON.stringify({ name, ...(description ? { description } : {}) }),
      })
    ).organization;
  }

  async organizations(): Promise<OrganizationRecord[]> {
    return (await this.request<{ organizations: OrganizationRecord[] }>("/api/v1/organizations")).organizations;
  }

  async updateOrganization(id: string, input: { name?: string; description?: string }): Promise<OrganizationRecord> {
    return (
      await this.request<{ organization: OrganizationRecord }>(`/api/v1/organizations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    ).organization;
  }

  async deleteOrganization(id: string, confirmation: string): Promise<void> {
    await this.request(`/api/v1/organizations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation }),
    });
  }

  async namespaces(): Promise<NamespaceRecord[]> {
    return (await this.request<{ namespaces: NamespaceRecord[] }>("/api/v1/namespaces")).namespaces;
  }

  async createNamespace(
    input: NamespaceOwner & { name: string; description?: string; visibility?: NamespaceRecord["visibility"] },
  ): Promise<NamespaceRecord> {
    return (
      await this.request<{ namespace: NamespaceRecord }>("/api/v1/namespaces", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).namespace;
  }

  async updateNamespace(
    name: string,
    input: NamespaceOwner & { description?: string; visibility?: NamespaceRecord["visibility"] },
  ): Promise<NamespaceRecord> {
    return (
      await this.request<{ namespace: NamespaceRecord }>(`/api/v1/namespaces/${encodeURIComponent(name)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    ).namespace;
  }

  async deleteNamespace(name: string): Promise<void> {
    await this.request(`/api/v1/namespaces/${encodeURIComponent(name)}`, { method: "DELETE" });
  }
}
