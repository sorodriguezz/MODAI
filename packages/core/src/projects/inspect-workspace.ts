import { AppError } from "@modai/contracts/errors";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import { authorize } from "../agents/tool-authorization.js";
import { readStoreRecord, storePackageDir, verifyStore } from "../installation/store.js";
import { normalizeManifest } from "../packages/normalize.js";
import { effectiveManifest } from "../packages/package-features.js";
import type { V1Project } from "./project.js";
import { loadGrants } from "./project-grants.js";

export interface InstalledPackage {
  name: string;
  version: string;
  kind: string;
  category: string;
  description: string;
  integrity: string;
  verified: boolean;
  manifest: PackageManifestV1;
  packageDir: string;
  files: string[];
  authorization: ReturnType<typeof authorize>;
}

export function inspectWorkspace(project: V1Project): InstalledPackage[] {
  const grants = loadGrants(project.root);
  return Object.entries(project.lock.packages).map(([name, locked]) => {
    const record = readStoreRecord(project.root, name);
    const verified = verifyStore(project.root, name, locked.integrity);
    const manifest = record ? effectiveManifest(normalizeManifest(record.manifest), locked.features) : undefined;
    if (!manifest) throw new AppError(409, "STORE_MISSING", `Falta ${name} en .modai/store; ejecuta modai sync`);
    return {
      name,
      version: locked.version,
      kind: locked.kind,
      category: locked.category,
      description: manifest.metadata.description,
      integrity: locked.integrity,
      verified,
      manifest,
      packageDir: storePackageDir(project.root, name),
      files: record!.files.map((file) => file.path),
      authorization: authorize(locked, grants.packages[name]),
    };
  });
}
