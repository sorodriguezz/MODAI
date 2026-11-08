import { AppError } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import type { PackageRecord, PublishPackageInput } from "@modai/contracts/types";
import { ApiClient } from "@modai/sdk";
import { computeIntegrity, verifyFiles } from "../packages/integrity.js";
import { latestPerName, type PackageArtifact, type PackageVersion, type Registry } from "./registry.js";

export class HttpRegistry implements Registry {
  readonly id: string;
  private readonly api: ApiClient;
  constructor(
    readonly url: string,
    token?: string,
    api?: ApiClient,
  ) {
    this.id = url.replace(/\/+$/, "");
    this.api = api ?? new ApiClient(url, token);
  }

  private async records(name?: string) {
    return (await this.api.listPackages(name, true)).filter((item) => !name || item.name === name);
  }

  async versions(name: string): Promise<PackageVersion[]> {
    return (await this.records(name)).map((item) => ({
      name: item.name,
      version: item.version,
      status: item.status,
      manifest: item.manifest,
      registry: this.id,
    }));
  }

  async fetch(name: string, version: string): Promise<PackageArtifact> {
    const record = (await this.records(name)).find((item) => item.version === version);
    if (!record) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}@${version} en ${this.id}`);
    return this.fetchRecord(record);
  }

  async fetchRecord(record: PackageRecord): Promise<PackageArtifact> {
    const { name, version } = record;
    const artifact = await this.api.artifact(record.artifactId);
    if (sha256(JSON.stringify({ files: artifact.files })) !== artifact.sha256)
      throw new AppError(400, "INTEGRITY_MISMATCH", `Integridad del artefacto inválida: ${name}`);
    verifyFiles(name, artifact.files);
    return {
      name,
      version,
      manifest: record.manifest,
      files: artifact.files,
      signature: record.signature,
      integrity: computeIntegrity(record.manifest, artifact.files),
      source: this.id,
    };
  }

  async list(query?: string): Promise<PackageVersion[]> {
    return latestPerName(
      (await this.records()).map((item) => ({
        name: item.name,
        version: item.version,
        status: item.status,
        manifest: item.manifest,
        registry: this.id,
      })),
      query,
    );
  }

  async publish(input: PublishPackageInput): Promise<{ name: string; version: string; integrity: string }> {
    const record = await this.api.publish(input);
    return { name: record.name, version: record.version, integrity: computeIntegrity(input.manifest, input.files) };
  }
}
