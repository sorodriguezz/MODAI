import type { ApiKeyRecord, Role, UserRecord } from "../types.js";
import { CategoriesApi } from "./categories.js";

export class AdminApi extends CategoriesApi {
  async users(): Promise<UserRecord[]> {
    return (await this.request<{ users: UserRecord[] }>("/api/v1/admin/users")).users;
  }

  async createUser(input: {
    username: string;
    password: string;
    role: Role;
    displayName?: string;
    projectIds?: string[];
    organizationIds?: string[];
    packageScopes?: string[];
  }): Promise<UserRecord> {
    return (
      await this.request<{ user: UserRecord }>("/api/v1/admin/users", { method: "POST", body: JSON.stringify(input) })
    ).user;
  }

  async updateUser(
    id: string,
    input: {
      displayName?: string;
      role?: Role;
      disabled?: boolean;
      password?: string;
      projectIds?: string[];
      organizationIds?: string[];
      packageScopes?: string[];
    },
  ): Promise<UserRecord> {
    return (
      await this.request<{ user: UserRecord }>(`/api/v1/admin/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    ).user;
  }

  async deleteUser(id: string): Promise<void> {
    await this.request(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async apiKeys(ownerId?: string): Promise<ApiKeyRecord[]> {
    return (
      await this.request<{ keys: ApiKeyRecord[] }>(
        `/api/v1/admin/api-keys${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ""}`,
      )
    ).keys;
  }

  async createApiKey(
    label: string,
    role: string,
    grants: { projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] } = {},
    options: { ownerId?: string | null; inherit?: boolean } = {},
  ): Promise<ApiKeyRecord & { token: string }> {
    return (
      await this.request<{ key: ApiKeyRecord & { token: string } }>("/api/v1/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({ label, role, ...grants, ...options }),
      })
    ).key;
  }

  async updateKeyGrants(
    id: string,
    grants: { projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] },
  ): Promise<void> {
    await this.request(`/api/v1/admin/api-keys/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(grants),
    });
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.request(`/api/v1/admin/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async myApiKeys(): Promise<ApiKeyRecord[]> {
    return (await this.request<{ keys: ApiKeyRecord[] }>("/api/v1/me/api-keys")).keys;
  }

  async revokeMyApiKey(id: string): Promise<void> {
    await this.request(`/api/v1/me/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async publishers(): Promise<Array<{ fingerprint: string; label?: string; trusted: boolean; createdAt: string }>> {
    return (await this.request<{ publishers: never[] }>("/api/v1/admin/publishers")).publishers;
  }

  async registerPublisher(publicKey: string, label: string, trusted: boolean): Promise<string> {
    return (
      await this.request<{ fingerprint: string }>("/api/v1/admin/publishers", {
        method: "POST",
        body: JSON.stringify({ publicKey, label, trusted }),
      })
    ).fingerprint;
  }

  async setPublisherTrust(fingerprint: string, trusted: boolean, label?: string): Promise<void> {
    await this.request(`/api/v1/admin/publishers/${encodeURIComponent(fingerprint)}`, {
      method: "PATCH",
      body: JSON.stringify({ trusted, ...(label ? { label } : {}) }),
    });
  }

  async audit(
    limit = 100,
  ): Promise<
    Array<{ id: string; actor: string; action: string; resource: string; details: unknown; createdAt: string }>
  > {
    return (await this.request<{ events: never[] }>(`/api/v1/admin/audit?limit=${limit}`)).events;
  }

  async exportBackup(): Promise<unknown> {
    return this.request("/api/v1/admin/export");
  }

  async importBackup(snapshot: unknown): Promise<unknown> {
    return this.request("/api/v1/admin/import", { method: "POST", body: JSON.stringify(snapshot) });
  }

  async prune(
    memoryDays?: number,
    auditDays?: number,
    dryRun = false,
  ): Promise<{ memories: number; audit: number; dryRun: boolean }> {
    return this.request("/api/v1/admin/prune", {
      method: "POST",
      body: JSON.stringify({ memoryDays, auditDays, ...(dryRun ? { dryRun } : {}) }),
    });
  }
}
