import { relative, resolve as resolvePath } from "node:path";
import { AppError } from "@modai/contracts/errors";
import type { PackageManifestV1, ProjectFile } from "@modai/contracts/manifest";
import { computeIntegrity } from "../packages/integrity.js";
import { normalizeManifest } from "../packages/normalize.js";
import { loadPackageSource } from "../packages/source.js";
import { validatePackage } from "../packages/validate.js";
import type { CompositeRegistry } from "../registries/composite-registry.js";
import type { PackageArtifact } from "../registries/registry.js";
import type { Candidate } from "../resolution/resolver.js";

export type WorkspaceRef = { kind: "registry" } | { kind: "file"; path: string; artifact: PackageArtifact };
export interface FileDependency {
  path: string;
  artifact: PackageArtifact;
  manifest: PackageManifestV1;
}

export function loadFileDependencies(root: string, file: ProjectFile): Map<string, FileDependency> {
  const fileDependencies = new Map<string, FileDependency>();
  for (const [name, spec] of Object.entries(file.dependencies)) {
    if (!spec.startsWith("file:")) continue;
    const directory = resolvePath(root, spec.slice(5));
    const input = loadPackageSource(directory);
    const manifest = validatePackage(input.manifest, input.files);
    if (manifest.metadata.name !== name)
      throw new AppError(400, "FILE_DEPENDENCY_MISMATCH", `${spec} contiene ${manifest.metadata.name}, no ${name}`);
    const path = relative(root, directory).replaceAll("\\", "/") || ".";
    fileDependencies.set(name, {
      path,
      manifest,
      artifact: {
        name,
        version: manifest.metadata.version,
        manifest: input.manifest,
        files: input.files,
        integrity: computeIntegrity(input.manifest, input.files),
        source: `file:${path}`,
      },
    });
  }
  return fileDependencies;
}

export function workspaceSource(
  registry: CompositeRegistry,
  fileDependencies: Map<string, FileDependency>,
  warnings: string[],
) {
  return {
    async versions(name: string): Promise<Array<Candidate<WorkspaceRef>>> {
      const local = fileDependencies.get(name);
      if (local)
        return [
          {
            version: local.manifest.metadata.version,
            status: "active",
            manifest: local.manifest,
            ref: { kind: "file", path: local.path, artifact: local.artifact },
          },
        ];
      const result: Array<Candidate<WorkspaceRef>> = [];
      for (const item of await registry.versions(name)) {
        try {
          result.push({
            version: item.version,
            status: item.status,
            manifest: normalizeManifest(item.manifest),
            ref: { kind: "registry" },
          });
        } catch (error) {
          warnings.push(`Se ignora ${name}@${item.version}: ${(error as Error).message}`);
        }
      }
      return result;
    },
  };
}
