import type {
  ArtifactFile,
  PackageManifest,
  PackageSignature,
  PackageStatus,
  PublishPackageInput,
} from "@modai/contracts/types";
import semver from "semver";

export interface PackageVersion {
  name: string;
  version: string;
  status: PackageStatus;
  manifest: PackageManifest;
  registry: string;
}

export interface PackageArtifact {
  name: string;
  version: string;
  manifest: PackageManifest;
  files: ArtifactFile[];
  signature?: PackageSignature;
  integrity: string;
  source: string;
}

export interface Registry {
  readonly id: string;
  versions(name: string): Promise<PackageVersion[]>;
  fetch(name: string, version: string): Promise<PackageArtifact>;
  list(query?: string): Promise<PackageVersion[]>;
  publish?(input: PublishPackageInput): Promise<{ name: string; version: string; integrity: string }>;
}

export function latestPerName(versions: PackageVersion[], query?: string): PackageVersion[] {
  const best = new Map<string, PackageVersion>();
  const needle = query?.toLocaleLowerCase();
  for (const item of versions) {
    if (item.status === "yanked") continue;
    if (needle && !`${item.name} ${JSON.stringify(item.manifest)}`.toLocaleLowerCase().includes(needle)) continue;
    const current = best.get(item.name);
    if (!current || semver.gt(item.version, current.version)) best.set(item.name, item);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}
