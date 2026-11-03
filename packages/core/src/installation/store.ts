import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArtifactFile, PackageManifest } from "@modai/contracts/types";
import { computeIntegrity } from "../packages/integrity.js";
import { removeProjectDirectory, safeProjectPath, writeProjectFile } from "./fs.js";
import { currentHash, readText } from "./project-files.js";

export const STORE_DIRECTORY = ".modai/store";
const STORE_RECORD = "modai-store.json";

export function storePath(name: string): string {
  return `${STORE_DIRECTORY}/${name}`;
}

export function storePackageDir(root: string, name: string): string {
  return join(dirname(safeProjectPath(root, `${storePath(name)}/${STORE_RECORD}`)), "files");
}

interface StoreRecord {
  name: string;
  version: string;
  integrity: string;
  manifest: PackageManifest;
  files: Array<{ path: string; sha256: string }>;
}

export function readStoreRecord(root: string, name: string): StoreRecord | undefined {
  const text = readText(root, `${storePath(name)}/${STORE_RECORD}`);
  return text ? (JSON.parse(text) as StoreRecord) : undefined;
}

export function writeStore(
  root: string,
  artifact: { name: string; version: string; integrity: string; manifest: PackageManifest; files: ArtifactFile[] },
): void {
  const existing = readStoreRecord(root, artifact.name);
  if (existing?.integrity === artifact.integrity && verifyStore(root, artifact.name, artifact.integrity)) return;
  removeProjectDirectory(root, storePath(artifact.name));
  for (const file of artifact.files)
    writeProjectFile(root, `${storePath(artifact.name)}/files/${file.path}`, Buffer.from(file.content, "base64"));
  const record: StoreRecord = {
    name: artifact.name,
    version: artifact.version,
    integrity: artifact.integrity,
    manifest: artifact.manifest,
    files: artifact.files.map(({ path, sha256: hash }) => ({ path, sha256: hash })),
  };
  writeProjectFile(root, `${storePath(artifact.name)}/${STORE_RECORD}`, `${JSON.stringify(record, null, 2)}\n`);
}

export function verifyStore(root: string, name: string, integrity: string): boolean {
  const record = readStoreRecord(root, name);
  if (!record || record.integrity !== integrity) return false;
  try {
    const files = record.files.map((file) => ({
      path: file.path,
      sha256: currentHash(root, `${storePath(name)}/files/${file.path}`) ?? "",
    }));
    if (files.some((file, index) => file.sha256 !== record.files[index].sha256)) return false;
    return computeIntegrity(record.manifest, files) === integrity;
  } catch {
    return false;
  }
}

export function readStoreFile(root: string, name: string, path: string): Buffer {
  return readFileSync(safeProjectPath(root, `${storePath(name)}/files/${path}`));
}

export function pruneStore(root: string, keep: Set<string>): string[] {
  const base = dirname(safeProjectPath(root, `${STORE_DIRECTORY}/.keep`));
  if (!existsSync(base)) return [];
  const removed: string[] = [];
  for (const scope of readdirSync(base).filter((entry) => entry.startsWith("@"))) {
    for (const short of readdirSync(join(base, scope))) {
      const name = `${scope}/${short}`;
      if (!keep.has(name)) {
        removeProjectDirectory(root, storePath(name));
        removed.push(name);
      }
    }
  }
  return removed;
}
