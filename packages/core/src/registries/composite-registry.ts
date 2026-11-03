import { AppError } from "@modai/contracts/errors";
import type { PackageArtifact, PackageVersion, Registry } from "./registry.js";

export class CompositeRegistry implements Registry {
  readonly id: string;
  constructor(readonly registries: Registry[]) {
    this.id = registries.map((item) => item.id).join(",");
  }

  async owner(name: string): Promise<Registry | undefined> {
    for (const registry of this.registries) {
      try {
        if ((await registry.versions(name)).length) return registry;
      } catch (error) {
        if (!(error instanceof AppError && error.statusCode === 404)) throw error;
      }
    }
    return undefined;
  }
  async versions(name: string): Promise<PackageVersion[]> {
    return (await (await this.owner(name))?.versions(name)) ?? [];
  }
  async fetch(name: string, version: string): Promise<PackageArtifact> {
    const registry = await this.owner(name);
    if (!registry) throw new AppError(404, "PACKAGE_NOT_FOUND", `Ningún registry configurado contiene ${name}`);
    return registry.fetch(name, version);
  }
  async list(query?: string): Promise<PackageVersion[]> {
    const seen = new Set<string>(),
      result: PackageVersion[] = [];
    for (const registry of this.registries) {
      for (const item of await registry.list(query).catch(() => []))
        if (!seen.has(item.name)) {
          seen.add(item.name);
          result.push(item);
        }
    }
    return result;
  }
}
