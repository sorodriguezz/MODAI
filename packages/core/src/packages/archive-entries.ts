import { sha256 } from "@modai/contracts/security";
import type { ArtifactFile } from "@modai/contracts/types";
import type { ArchiveEntry } from "./zip.js";

export function toArtifactFiles(entries: ArchiveEntry[]): ArtifactFile[] {
  return entries.map((entry) => ({
    path: entry.path,
    content: entry.bytes.toString("base64"),
    sha256: sha256(entry.bytes),
  }));
}

export function stripSingleRoot(entries: ArchiveEntry[]): { root?: string; entries: ArchiveEntry[] } {
  const roots = new Set(entries.map((entry) => entry.path.split("/")[0]));
  if (roots.size !== 1 || entries.some((entry) => !entry.path.includes("/"))) return { entries };
  const root = [...roots][0]!;
  return { root, entries: entries.map((entry) => ({ path: entry.path.slice(root.length + 1), bytes: entry.bytes })) };
}
