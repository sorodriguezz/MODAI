import type { ArtifactFile, PackageRecord, PublishPackageInput, QualityReport } from "../core/types.js";

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  packageName?: string;
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(server: string, private readonly token?: string) {
    this.baseUrl = server.replace(/\/+$/, "");
  }

  async health(): Promise<{ status: string; version: string }> {
    return this.request("/health");
  }

  async listPackages(query?: string, includeYanked = false): Promise<PackageRecord[]> {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (includeYanked) search.set("includeYanked", "true");
    const suffix = search.size ? `?${search}` : "";
    const response = await this.request<{ packages: PackageRecord[] }>(`/api/v1/packages${suffix}`);
    return response.packages;
  }

  async publish(input: PublishPackageInput): Promise<PackageRecord> {
    const response = await this.request<{ package: PackageRecord }>("/api/v1/packages", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.package;
  }

  async validatePackage(input: PublishPackageInput): Promise<QualityReport> {
    const response = await this.request<{ quality: QualityReport }>("/api/v1/packages/validate", { method: "POST", body: JSON.stringify(input) });
    return response.quality;
  }

  async resolve(packages: Array<{ name: string; range: string }>, overrides?: Record<string, string>): Promise<PackageRecord[]> {
    const response = await this.request<{ packages: PackageRecord[] }>("/api/v1/resolve", {
      method: "POST",
      body: JSON.stringify({ packages, overrides }),
    });
    return response.packages;
  }

  async artifact(id: string): Promise<{ files: ArtifactFile[]; sha256: string }> {
    return this.request(`/api/v1/artifacts/${encodeURIComponent(id)}`);
  }

  async searchKnowledge(query: string, packageNames?: string[]): Promise<unknown[]> {
    const response = await this.request<{ results: unknown[] }>("/api/v1/knowledge/search", {
      method: "POST",
      body: JSON.stringify({ query, packageNames }),
    });
    return response.results;
  }

  async knowledgeDocuments(offset = 0): Promise<{ documents: KnowledgeDocument[]; nextOffset: number | null }> {
    return this.request(`/api/v1/knowledge/documents?limit=100&offset=${offset}`);
  }

  async saveVector(id: string, model: string, embedding: number[], sourceHash?: string): Promise<void> {
    await this.request(`/api/v1/knowledge/documents/${encodeURIComponent(id)}/vector`, { method: "PUT", body: JSON.stringify({ model, embedding, sourceHash }) });
  }

  async vectorSearch(model: string, embedding: number[], packageNames?: string[]): Promise<unknown[]> {
    const data = await this.request<{ results: unknown[] }>("/api/v1/knowledge/vector-search", { method: "POST", body: JSON.stringify({ model, embedding, packageNames }) });
    return data.results;
  }

  async remember(input: { projectId: string; content: string; kind?: string; scope?: string }): Promise<unknown> {
    const response = await this.request<{ memory: unknown }>("/api/v1/memories", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.memory;
  }

  async recall(projectId: string, query: string): Promise<unknown[]> {
    const response = await this.request<{ results: unknown[] }>("/api/v1/memories/search", {
      method: "POST",
      body: JSON.stringify({ projectId, query }),
    });
    return response.results;
  }

  async listMemories(projectId: string): Promise<unknown[]> {
    const response = await this.request<{ memories: unknown[] }>(`/api/v1/memories?projectId=${encodeURIComponent(projectId)}`);
    return response.memories;
  }

  async updateMemory(id: string, input: Record<string, unknown>): Promise<unknown> {
    const response = await this.request<{ memory: unknown }>(`/api/v1/memories/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
    return response.memory;
  }

  async deleteMemory(id: string): Promise<void> {
    await this.request(`/api/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async deprecate(name: string, version: string, message: string): Promise<PackageRecord> {
    const response = await this.request<{ package: PackageRecord }>("/api/v1/admin/packages/deprecate", { method: "POST", body: JSON.stringify({ name, version, message }) });
    return response.package;
  }

  async yank(name: string, version: string, reason: string): Promise<PackageRecord> {
    const response = await this.request<{ package: PackageRecord }>("/api/v1/admin/packages/yank", { method: "POST", body: JSON.stringify({ name, version, reason }) });
    return response.package;
  }

  async hardDelete(name: string, version: string): Promise<void> {
    await this.request("/api/v1/admin/packages", { method: "DELETE", body: JSON.stringify({ name, version, confirmation: `${name}@${version}` }) });
  }

  async exportBackup(): Promise<unknown> {
    return this.request("/api/v1/admin/export");
  }

  async importBackup(snapshot: unknown): Promise<unknown> {
    return this.request("/api/v1/admin/import", { method: "POST", body: JSON.stringify(snapshot) });
  }

  async createApiKey(label: string, role: string): Promise<unknown> {
    return this.request("/api/v1/admin/api-keys", { method: "POST", body: JSON.stringify({ label, role }) });
  }

  async prune(memoryDays: number, auditDays: number): Promise<unknown> {
    return this.request("/api/v1/admin/prune", { method: "POST", body: JSON.stringify({ memoryDays, auditDays }) });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new Error(`No se pudo conectar con ${this.baseUrl}: ${(error as Error).message}`);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new Error(`${body.error?.code ?? `HTTP_${response.status}`}: ${body.error?.message ?? response.statusText}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
