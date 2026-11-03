import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { safeProjectPath } from "../installation/fs.js";
import { listPackageFiles } from "./source-files.js";

type Contributes = Record<string, unknown[]>;
export type RawManifestV1 = {
  spec?: {
    entrypoints?: { skills?: string; knowledge?: string; rules?: string };
    contributes?: Contributes;
    include?: string[];
    features?: unknown;
  };
};

function firstHeading(content: string, fallback: string): string {
  return (
    content
      .match(/^#\s+(.+)$/m)?.[1]
      ?.trim()
      .slice(0, 300) || fallback
  );
}

function namedEntries(contributes: Contributes, key: string): Set<string | undefined> {
  const entries = (contributes[key] as Array<{ name?: string; path?: string }> | undefined) ?? [];
  return new Set(entries.map((item) => item.name ?? item.path));
}

function appendEntry(contributes: Contributes, key: string, entry: unknown): void {
  const list = contributes[key] ?? [];
  list.push(entry);
  contributes[key] = list;
}

const directoryExists = (root: string, path: string | undefined): path is string =>
  Boolean(path) && existsSync(safeProjectPath(root, path as string, false, true));

function expandSkills(root: string, directory: string, contributes: Contributes): void {
  const known = namedEntries(contributes, "skills");
  for (const name of readdirSync(safeProjectPath(root, directory, false, true)).sort()) {
    const path = posix.join(directory, name);
    if (!known.has(name) && existsSync(join(safeProjectPath(root, path, false, true), "SKILL.md")))
      appendEntry(contributes, "skills", { name, path });
  }
}

function expandKnowledge(root: string, directory: string, contributes: Contributes): void {
  const known = namedEntries(contributes, "knowledge");
  for (const path of listPackageFiles(root, directory).filter((file) => /\.(md|txt)$/i.test(file))) {
    if (known.has(path)) continue;
    const title = firstHeading(readFileSync(safeProjectPath(root, path), "utf8"), basename(path));
    appendEntry(contributes, "knowledge", { path, title, tags: [] });
  }
}

function expandRules(root: string, directory: string, contributes: Contributes): void {
  const known = namedEntries(contributes, "rules");
  for (const path of listPackageFiles(root, directory).filter((file) => /\.md$/i.test(file))) {
    const name = basename(path)
      .replace(/\.md$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    if (!known.has(name)) appendEntry(contributes, "rules", { name, path });
  }
}

export function expandEntrypoints(root: string, manifest: RawManifestV1): void {
  const spec = manifest.spec ?? {};
  const entrypoints = spec.entrypoints;
  if (!entrypoints) return;
  if (spec.contributes === undefined || spec.contributes === null) spec.contributes = {};
  const contributes = spec.contributes;
  if (directoryExists(root, entrypoints.skills)) expandSkills(root, entrypoints.skills, contributes);
  if (directoryExists(root, entrypoints.knowledge)) expandKnowledge(root, entrypoints.knowledge, contributes);
  if (directoryExists(root, entrypoints.rules)) expandRules(root, entrypoints.rules, contributes);
  delete spec.entrypoints;
}
