import type { ArtifactFile, PackageRecord, PublishPackageInput, QualityReport } from "@modai/contracts/types";
import { SessionApi } from "./session.js";

export class PackagesApi extends SessionApi {
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
    const response = await this.request<{ quality: QualityReport }>("/api/v1/packages/validate", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.quality;
  }

  async resolve(
    packages: Array<{ name: string; range: string }>,
    overrides?: Record<string, string>,
  ): Promise<PackageRecord[]> {
    const response = await this.request<{ packages: PackageRecord[] }>("/api/v1/resolve", {
      method: "POST",
      body: JSON.stringify({ packages, overrides }),
    });
    return response.packages;
  }

  async artifact(id: string): Promise<{ files: ArtifactFile[]; sha256: string }> {
    return this.request(`/api/v1/artifacts/${encodeURIComponent(id)}`);
  }

  async getPackage(name: string, version?: string): Promise<PackageRecord> {
    return (
      await this.request<{ package: PackageRecord }>(
        `/api/v1/package?name=${encodeURIComponent(name)}${version ? `&version=${encodeURIComponent(version)}` : ""}`,
      )
    ).package;
  }

  async catalog(
    options: { type?: string; q?: string; limit?: number; offset?: number } = {},
  ): Promise<{ items: Array<PackageRecord & { versions: number }>; total: number }> {
    const search = new URLSearchParams(
      Object.entries(options)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    );
    return this.request(`/api/v1/packages/catalog?${search}`);
  }

  async importSkill(input: {
    archive: string;
    namespace: string;
    version?: string;
    name?: string;
    dryRun?: boolean;
  }): Promise<{
    package?: PackageRecord;
    name?: string;
    files?: Array<{ path: string; size: number }>;
    quality?: QualityReport;
  }> {
    return this.request("/api/v1/packages/import-skill", { method: "POST", body: JSON.stringify(input) });
  }

  async deprecate(name: string, version: string, message: string): Promise<PackageRecord> {
    const response = await this.request<{ package: PackageRecord }>("/api/v1/admin/packages/deprecate", {
      method: "POST",
      body: JSON.stringify({ name, version, message }),
    });
    return response.package;
  }

  async yank(name: string, version: string, reason: string): Promise<PackageRecord> {
    const response = await this.request<{ package: PackageRecord }>("/api/v1/admin/packages/yank", {
      method: "POST",
      body: JSON.stringify({ name, version, reason }),
    });
    return response.package;
  }

  async hardDelete(name: string, version: string): Promise<void> {
    await this.request("/api/v1/admin/packages", {
      method: "DELETE",
      body: JSON.stringify({ name, version, confirmation: `${name}@${version}` }),
    });
  }

  async packageUsage(
    name: string,
  ): Promise<Array<{ projectId: string; projectName: string; version: string; direct: boolean; reportedAt: string }>> {
    return (await this.request<{ projects: never[] }>(`/api/v1/packages/usage?name=${encodeURIComponent(name)}`))
      .projects;
  }
}
