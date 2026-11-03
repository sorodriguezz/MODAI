import type { ArtifactFile, PackageRecord, PublishPackageInput, QualityReport, ProjectRecord, AgentBundle, RunRecord, ClaimedRun, MemoryInput, SignaturePolicy } from "@modai/contracts/types";

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  packageName?: string;
}

export type Role = "reader" | "publisher" | "worker" | "org-admin" | "admin";

/** What the identity behind a token may do, as computed by the server (0.9+). */
export interface Permissions {
  role: Role; global: boolean;
  manage: { users: boolean; apiKeys: boolean; organizations: boolean; createOrganizations: boolean; namespaces: boolean; audit: boolean; publishers: boolean; backup: boolean; packages: boolean };
  assignableRoles: Role[];
  createProjects: boolean; writeKnowledge: boolean; writeMemory: boolean; submitRuns: boolean;
  publish: { all: boolean; namespaces: string[] };
  packages: { all: boolean; namespaces: string[] };
  organizations: Array<{ id: string; name: string; manage: boolean }>;
}

export interface OrganizationRecord { id: string; name: string; description: string; projects: number; namespaces: number; members: number; canManage: boolean }
export interface CategoryRecord { name: string; description: string; registered: boolean; packages: number; createdAt?: string; updatedAt?: string }
export interface NamespaceRecord { name: string; organizationId?: string; organizationName?: string; description: string; visibility: "internal" | "restricted"; packages: number; canManage: boolean; canPublish: boolean }

export interface ApiKeyRecord { id: string; label: string; role: Role; createdAt: string; lastUsedAt?: string; revokedAt?: string; ownerId?: string; ownerName?: string; inherit: boolean; projectIds: string[]; organizationIds: string[]; packageScopes: string[] }
export interface UserRecord { id: string; username: string; displayName: string; role: Role; projectIds: string[]; organizationIds: string[]; packageScopes: string[]; createdAt: string; lastLoginAt?: string; disabledAt?: string }

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

  async session(): Promise<{ label: string; role: Role; projectIds: string[]; organizationIds: string[]; packageScopes: string[]; permissions: Permissions }> {
    return this.request("/api/v1/session");
  }

  /** Fails early, with the namespaces the token can use, instead of a bare 403 after uploading the package. */
  async assertCanPublish(packageName: string): Promise<void> {
    const { label, role, permissions } = await this.session();
    const namespace = packageName.split("/")[0];
    if (permissions.publish.all || permissions.publish.namespaces.includes(namespace)) return;
    const allowed = permissions.publish.namespaces.length ? `Puede publicar en: ${permissions.publish.namespaces.join(", ")}.` : "No puede publicar en ningún namespace.";
    throw new Error(`PACKAGE_FORBIDDEN: La credencial «${label}» (rol ${role}) no puede publicar en ${namespace}. ${allowed} Pide acceso a la administración de la organización dueña del namespace.`);
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
    const manifest = input.manifest as { name?: string; metadata?: { name?: string } };
    const name = manifest.metadata?.name ?? manifest.name;
    if (name) await this.assertCanPublish(name);
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

  /** A key for a user (`ownerId`), within that user's permissions; without explicit grants it inherits them. */
  async createApiKey(label: string, role: string, grants: { projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] } = {}, options: { ownerId?: string | null; inherit?: boolean } = {}): Promise<ApiKeyRecord & { token: string }> {
    return (await this.request<{ key: ApiKeyRecord & { token: string } }>("/api/v1/admin/api-keys", { method: "POST", body: JSON.stringify({ label, role, ...grants, ...options }) })).key;
  }
  /** Keys of the user behind this credential. */
  async myApiKeys(): Promise<ApiKeyRecord[]> { return (await this.request<{ keys: ApiKeyRecord[] }>("/api/v1/me/api-keys")).keys; }
  async revokeMyApiKey(id: string): Promise<void> { await this.request(`/api/v1/me/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }); }

  /** Only the targets given are pruned; `dryRun` counts without deleting. */
  async prune(memoryDays?: number, auditDays?: number, dryRun = false): Promise<{ memories: number; audit: number; dryRun: boolean }> {
    return this.request("/api/v1/admin/prune", { method: "POST", body: JSON.stringify({ memoryDays, auditDays, ...(dryRun ? { dryRun } : {}) }) });
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
  /** Irreversible: deletes the project with its memories, runs and usage reports. */
  async deleteProject(id: string): Promise<{ deleted: ProjectRecord; memories: number; runs: number }> {
    return this.request(`/api/v1/projects/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirmation: id }) });
  }
  async projects(): Promise<ProjectRecord[]> { return (await this.request<{ projects: ProjectRecord[] }>("/api/v1/projects")).projects; }
  async agents(): Promise<PackageRecord[]> { return (await this.request<{ agents: PackageRecord[] }>("/api/v1/agents")).agents; }
  async capabilities(capability?: string): Promise<{ builtin: unknown[]; contracts: unknown[] }> { return this.request<{ builtin: unknown[]; contracts: unknown[] }>(`/api/v1/capabilities${capability ? `?capability=${encodeURIComponent(capability)}` : ""}`); }
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
  async createOrganization(name: string, description?: string): Promise<{ id: string; name: string }> {
    return (await this.request<{ organization: { id: string; name: string } }>("/api/v1/organizations", { method: "POST", body: JSON.stringify({ name, ...(description ? { description } : {}) }) })).organization;
  }
  async organizations(): Promise<OrganizationRecord[]> { return (await this.request<{ organizations: OrganizationRecord[] }>("/api/v1/organizations")).organizations; }
  async namespaces(): Promise<NamespaceRecord[]> { return (await this.request<{ namespaces: NamespaceRecord[] }>("/api/v1/namespaces")).namespaces; }
  async createNamespace(input: { name: string; organizationId?: string; description?: string; visibility?: "internal" | "restricted" }): Promise<NamespaceRecord> {
    return (await this.request<{ namespace: NamespaceRecord }>("/api/v1/namespaces", { method: "POST", body: JSON.stringify(input) })).namespace;
  }

  // ------------------------------------------------------------- templates (packages of kind Template)
  async templates(query?: string): Promise<Array<PackageRecord & { versions: number }>> {
    return (await this.catalog({ type: "templates", q: query, limit: 100 })).items;
  }
  /** The files of a template version (the newest one still in use when `version` is omitted). */
  async templateFiles(name: string, version?: string): Promise<{ template: PackageRecord; files: ArtifactFile[]; sha256: string }> {
    const template = await this.getPackage(name, version);
    if (template.manifest.kind !== "Template") throw new Error(`${name} no es un template de proyecto: instálalo con modai add ${name}`);
    const artifact = await this.artifact(template.artifactId);
    return { template, files: artifact.files, sha256: artifact.sha256 };
  }
  /** Features and add-on declaration (modai.template.yaml) of a template version, and its files. */
  async templateInfo(name: string, version?: string): Promise<{ package: PackageRecord; features: Array<{ name: string; description: string; default: boolean; requires: string[]; conflicts: string[]; uses?: string; path?: string; vars: Record<string, string> }>; addon?: { for: string[] }; manifestError?: string; files: Array<{ path: string; size: number }> }> {
    return this.request(`/api/v1/packages/template?name=${encodeURIComponent(name)}${version ? `&version=${encodeURIComponent(version)}` : ""}`);
  }
  /** Publishes a folder (files) or a .zip (archive) as a new `kind: Template` package version. */
  async importTemplate(input: { name: string; version: string; description: string; category?: string; keywords?: string[]; files?: ArtifactFile[]; archive?: string }): Promise<PackageRecord> {
    const namespace = input.name.split("/")[0]!;
    const { permissions } = await this.session();
    if (!permissions.publish.all && !permissions.publish.namespaces.includes(namespace)) throw new Error(`PACKAGE_FORBIDDEN: no puedes publicar en ${namespace}. ${permissions.publish.namespaces.length ? `Puedes publicar en: ${permissions.publish.namespaces.join(", ")}.` : ""}`);
    return (await this.request<{ package: PackageRecord }>("/api/v1/packages/import-template", { method: "POST", body: JSON.stringify(input) })).package;
  }

  // ------------------------------------------------------------- packages & skills
  async getPackage(name: string, version?: string): Promise<PackageRecord> {
    return (await this.request<{ package: PackageRecord }>(`/api/v1/package?name=${encodeURIComponent(name)}${version ? `&version=${encodeURIComponent(version)}` : ""}`)).package;
  }
  async catalog(options: { type?: string; q?: string; limit?: number; offset?: number } = {}): Promise<{ items: Array<PackageRecord & { versions: number }>; total: number }> {
    const search = new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
    return this.request(`/api/v1/packages/catalog?${search}`);
  }
  async importSkill(input: { archive: string; namespace: string; version?: string; name?: string; dryRun?: boolean }): Promise<{ package?: PackageRecord; name?: string; files?: Array<{ path: string; size: number }>; quality?: QualityReport }> {
    return this.request("/api/v1/packages/import-skill", { method: "POST", body: JSON.stringify(input) });
  }

  // ----------------------------------------------------------- shared knowledge
  async createKnowledge(input: { title: string; content: string; tags?: string[] }): Promise<KnowledgeDocument> {
    return (await this.request<{ document: KnowledgeDocument }>("/api/v1/knowledge/documents", { method: "POST", body: JSON.stringify(input) })).document;
  }
  async updateKnowledge(id: string, input: { title?: string; content?: string; tags?: string[] }): Promise<KnowledgeDocument> {
    return (await this.request<{ document: KnowledgeDocument }>(`/api/v1/knowledge/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })).document;
  }
  async deleteKnowledge(id: string): Promise<void> {
    await this.request(`/api/v1/knowledge/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  // ------------------------------------------------- users, keys and directory
  async users(): Promise<UserRecord[]> { return (await this.request<{ users: UserRecord[] }>("/api/v1/admin/users")).users; }
  async createUser(input: { username: string; password: string; role: Role; displayName?: string; projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] }): Promise<UserRecord> {
    return (await this.request<{ user: UserRecord }>("/api/v1/admin/users", { method: "POST", body: JSON.stringify(input) })).user;
  }
  async updateUser(id: string, input: { displayName?: string; role?: Role; disabled?: boolean; password?: string; projectIds?: string[]; organizationIds?: string[]; packageScopes?: string[] }): Promise<UserRecord> {
    return (await this.request<{ user: UserRecord }>(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })).user;
  }
  async deleteUser(id: string): Promise<void> { await this.request(`/api/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async apiKeys(ownerId?: string): Promise<ApiKeyRecord[]> {
    return (await this.request<{ keys: ApiKeyRecord[] }>(`/api/v1/admin/api-keys${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ""}`)).keys;
  }
  async revokeApiKey(id: string): Promise<void> { await this.request(`/api/v1/admin/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  async updateOrganization(id: string, input: { name?: string; description?: string }): Promise<OrganizationRecord> {
    return (await this.request<{ organization: OrganizationRecord }>(`/api/v1/organizations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })).organization;
  }
  async deleteOrganization(id: string, confirmation: string): Promise<void> {
    await this.request(`/api/v1/organizations/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ confirmation }) });
  }
  async updateNamespace(name: string, input: { organizationId?: string | null; description?: string; visibility?: "internal" | "restricted" }): Promise<NamespaceRecord> {
    return (await this.request<{ namespace: NamespaceRecord }>(`/api/v1/namespaces/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify(input) })).namespace;
  }
  async deleteNamespace(name: string): Promise<void> { await this.request(`/api/v1/namespaces/${encodeURIComponent(name)}`, { method: "DELETE" }); }
  // ------------------------------------------------------------- categories, usage, projects, publishers
  async categories(): Promise<CategoryRecord[]> { return (await this.request<{ categories: CategoryRecord[] }>("/api/v1/categories")).categories; }
  async createCategory(input: { name: string; description?: string }): Promise<CategoryRecord> {
    return (await this.request<{ category: CategoryRecord }>("/api/v1/categories", { method: "POST", body: JSON.stringify(input) })).category;
  }
  async updateCategory(name: string, input: { description: string }): Promise<CategoryRecord> {
    return (await this.request<{ category: CategoryRecord }>(`/api/v1/categories/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify(input) })).category;
  }
  async deleteCategory(name: string): Promise<void> { await this.request(`/api/v1/categories/${encodeURIComponent(name)}`, { method: "DELETE" }); }
  /** Projects linked to this server that reported installing `name` (only those the credential may see). */
  async packageUsage(name: string): Promise<Array<{ projectId: string; projectName: string; version: string; direct: boolean; reportedAt: string }>> {
    return (await this.request<{ projects: never[] }>(`/api/v1/packages/usage?name=${encodeURIComponent(name)}`)).projects;
  }
  async updateProject(id: string, input: { name?: string; organizationId?: string | null }): Promise<ProjectRecord> {
    return (await this.request<{ project: ProjectRecord }>(`/api/v1/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })).project;
  }
  async publishers(): Promise<Array<{ fingerprint: string; label?: string; trusted: boolean; createdAt: string }>> {
    return (await this.request<{ publishers: never[] }>("/api/v1/admin/publishers")).publishers;
  }
  async setPublisherTrust(fingerprint: string, trusted: boolean, label?: string): Promise<void> {
    await this.request(`/api/v1/admin/publishers/${encodeURIComponent(fingerprint)}`, { method: "PATCH", body: JSON.stringify({ trusted, ...(label ? { label } : {}) }) });
  }

  async audit(limit = 100): Promise<Array<{ id: string; actor: string; action: string; resource: string; details: unknown; createdAt: string }>> {
    return (await this.request<{ events: never[] }>(`/api/v1/admin/audit?limit=${limit}`)).events;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        ...init,
        headers: {
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
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
