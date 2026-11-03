import type { ArtifactFile, PackageRecord, PublishPackageInput, QualityReport, ProjectRecord, AgentBundle, RunRecord, ClaimedRun, MemoryInput, SignaturePolicy } from "@modai/contracts/types";

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  packageName?: string;
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(server: string, private readonly token?: string) {
    const url = new URL(server);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("URL de MODAI inválida");
    this.baseUrl = server.replace(/\/+$/, "");
  }

  async health(): Promise<{ status: string; version: string; apiVersion: number; signaturePolicy: SignaturePolicy; publicUrl?: string }> {
    return this.request("/health");
  }

  async session(): Promise<{ label: string; role: "reader" | "publisher" | "worker" | "admin"; projectIds: string[]; organizationIds: string[]; packageScopes: string[] }> {
    return this.request("/api/v1/session");
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

  async remember(input: MemoryInput): Promise<unknown> {
    const response = await this.request<{ memory: unknown }>("/api/v1/memories", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.memory;
  }

  async recall(projectId: string, query: string, options: { includeOrganization?: boolean; sessionId?: string } = {}): Promise<unknown[]> {
    const response = await this.request<{ results: unknown[] }>("/api/v1/memories/search", {
      method: "POST",
      body: JSON.stringify({ projectId, query, ...options }),
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

  async createApiKey(label: string, role: string, grants: { projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] } = {}): Promise<unknown> {
    return this.request("/api/v1/admin/api-keys", { method: "POST", body: JSON.stringify({ label, role, ...grants }) });
  }

  async prune(memoryDays: number, auditDays: number): Promise<unknown> {
    return this.request("/api/v1/admin/prune", { method: "POST", body: JSON.stringify({ memoryDays, auditDays }) });
  }

  /** Tells the server what this project has installed (shown in the panel as "who uses this package"). */
  async reportInstallations(projectId: string, packages: Array<{ name: string; version: string; direct?: boolean }>, signal?: AbortSignal): Promise<void> {
    await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/installations`, { method: "PUT", body: JSON.stringify({ packages }), signal });
  }

  async assertCompatible(): Promise<void> {
    const info = await this.health();
    if (info.apiVersion !== 1) throw new Error(`API incompatible: se requiere v1 (servidor ${info.version})`);
  }

  async createProject(input: { id?: string; name: string; organizationId?: string }): Promise<ProjectRecord> {
    return (await this.request<{ project: ProjectRecord }>("/api/v1/projects", { method: "POST", body: JSON.stringify(input) })).project;
  }
  async projects(): Promise<ProjectRecord[]> { return (await this.request<{ projects: ProjectRecord[] }>("/api/v1/projects")).projects; }
  async agents(): Promise<PackageRecord[]> { return (await this.request<{ agents: PackageRecord[] }>("/api/v1/agents")).agents; }
  async capabilities(): Promise<unknown[]> { return (await this.request<{ capabilities: unknown[] }>("/api/v1/capabilities")).capabilities; }
  async composeAgent(projectId: string, name: string, range = "*", overrides?: Record<string, string>): Promise<AgentBundle> {
    return (await this.request<{ bundle: AgentBundle }>("/api/v1/agents/compose", { method: "POST", body: JSON.stringify({ projectId, name, range, overrides }) })).bundle;
  }
  async submitRun(input: { projectId: string; name: string; range?: string; task: string; overrides?: Record<string, string>; idempotencyKey?: string }): Promise<RunRecord> {
    return (await this.request<{ run: RunRecord }>("/api/v1/runs", { method: "POST", body: JSON.stringify(input) })).run;
  }
  async runs(projectId: string): Promise<RunRecord[]> { return (await this.request<{ runs: RunRecord[] }>(`/api/v1/runs?projectId=${encodeURIComponent(projectId)}`)).runs; }
  async run(id: string): Promise<RunRecord> { return (await this.request<{ run: RunRecord }>(`/api/v1/runs/${encodeURIComponent(id)}`)).run; }
  async cancelRun(id: string): Promise<RunRecord> { return (await this.request<{ run: RunRecord }>(`/api/v1/runs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" })).run; }
  async claimRun(projectId: string): Promise<ClaimedRun | null> {
    return (await this.request<{ claimed: ClaimedRun | null }>("/api/v1/worker/claim", { method: "POST", body: JSON.stringify({ projectId }) })).claimed;
  }
  async heartbeat(id: string, leaseToken: string): Promise<string> {
    return (await this.request<{ leaseExpiresAt: string }>(`/api/v1/worker/runs/${encodeURIComponent(id)}/heartbeat`, { method: "POST", body: JSON.stringify({ leaseToken }) })).leaseExpiresAt;
  }
  async finishRun(id: string, leaseToken: string, outcome: { result: string } | { error: string }): Promise<RunRecord> {
    return (await this.request<{ run: RunRecord }>(`/api/v1/worker/runs/${encodeURIComponent(id)}/finish`, { method: "POST", body: JSON.stringify({ leaseToken, ...outcome }) })).run;
  }
  async updateKeyGrants(id: string, grants: { projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] }): Promise<void> {
    await this.request(`/api/v1/admin/api-keys/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(grants) });
  }
  async registerPublisher(publicKey: string, label: string, trusted: boolean): Promise<string> {
    return (await this.request<{ fingerprint: string }>("/api/v1/admin/publishers", { method: "POST", body: JSON.stringify({ publicKey, label, trusted }) })).fingerprint;
  }
  async createOrganization(name: string): Promise<{ id: string; name: string }> {
    return (await this.request<{ organization: { id: string; name: string } }>("/api/v1/admin/organizations", { method: "POST", body: JSON.stringify({ name }) })).organization;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
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
