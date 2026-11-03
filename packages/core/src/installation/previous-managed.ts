import type { ManagedEntry } from "@modai/contracts/manifest";

export type ManagedFileEntry = Extract<ManagedEntry, { type: "file" }>;
export type ManagedBlockEntry = Extract<ManagedEntry, { type: "block" }>;
export type ManagedJsonEntry = Extract<ManagedEntry, { type: "json" }>;

export interface PreviousManaged {
  files: Map<string, ManagedFileEntry>;
  blocks: Map<string, ManagedBlockEntry>;
  json: Map<string, ManagedJsonEntry>;
}

export const fileKey = (path: string) => path.toLowerCase();
export const blockKey = (path: string, id: string) => `${path.toLowerCase()}#${id}`;
export const jsonKey = (path: string, pointer: string) => `${path.toLowerCase()}#${pointer}`;

export function indexPreviousManaged(previous: ManagedEntry[]): PreviousManaged {
  const index: PreviousManaged = { files: new Map(), blocks: new Map(), json: new Map() };
  for (const entry of previous) {
    if (entry.type === "file") index.files.set(fileKey(entry.path), entry);
    else if (entry.type === "block") index.blocks.set(blockKey(entry.path, entry.id), entry);
    else index.json.set(jsonKey(entry.path, entry.pointer), entry);
  }
  return index;
}
