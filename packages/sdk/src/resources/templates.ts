import type { ArtifactFile, PackageRecord } from "@modai/contracts/types";
import { PackagesApi } from "./packages.js";

export class TemplatesApi extends PackagesApi {
  async templates(query?: string): Promise<Array<PackageRecord & { versions: number }>> {
    return (await this.catalog({ type: "templates", q: query, limit: 100 })).items;
  }

  async templateFiles(
    name: string,
    version?: string,
  ): Promise<{ template: PackageRecord; files: ArtifactFile[]; sha256: string }> {
    const template = await this.getPackage(name, version);
    if (template.manifest.kind !== "Template")
      throw new Error(`${name} no es un template de proyecto: instálalo con modai add ${name}`);
    const artifact = await this.artifact(template.artifactId);
    return { template, files: artifact.files, sha256: artifact.sha256 };
  }

  async templateInfo(
    name: string,
    version?: string,
  ): Promise<{
    package: PackageRecord;
    features: Array<{
      name: string;
      description: string;
      default: boolean;
      requires: string[];
      conflicts: string[];
      uses?: string;
      path?: string;
      vars: Record<string, string>;
    }>;
    addon?: { for: string[] };
    manifestError?: string;
    files: Array<{ path: string; size: number }>;
  }> {
    return this.request(
      `/api/v1/packages/template?name=${encodeURIComponent(name)}${version ? `&version=${encodeURIComponent(version)}` : ""}`,
    );
  }

  async importTemplate(input: {
    name: string;
    version: string;
    description: string;
    category?: string;
    keywords?: string[];
    files?: ArtifactFile[];
    archive?: string;
  }): Promise<PackageRecord> {
    const namespace = input.name.split("/")[0]!;
    const { permissions } = await this.session();
    if (!permissions.publish.all && !permissions.publish.namespaces.includes(namespace))
      throw new Error(
        `PACKAGE_FORBIDDEN: no puedes publicar en ${namespace}. ${permissions.publish.namespaces.length ? `Puedes publicar en: ${permissions.publish.namespaces.join(", ")}.` : ""}`,
      );
    return (
      await this.request<{ package: PackageRecord }>("/api/v1/packages/import-template", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).package;
  }
}
