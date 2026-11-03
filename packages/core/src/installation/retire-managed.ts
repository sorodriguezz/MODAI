import { sha256 } from "@modai/contracts/security";
import { SIDE_BY_SIDE_SUFFIX } from "./apply-conflicts.js";
import type { DesiredState } from "./desired-state.js";
import { removeProjectFile, writeProjectFile } from "./fs.js";
import { getPointer, jsonHash, pruneEmpty, setPointer } from "./json-pointer.js";
import { findBlock, removeBlock } from "./managed-blocks.js";
import { blockKey, fileKey, jsonKey, type PreviousManaged } from "./previous-managed.js";
import { currentHash, managedHash, readJson, readText } from "./project-files.js";

export interface RetireReport {
  removed: string[];
  preserved: string[];
}

export function removeStaleSideBySide(root: string, path: string, hash: string): void {
  const side = `${path}${SIDE_BY_SIDE_SUFFIX}`;
  if (currentHash(root, side) === hash) removeProjectFile(root, side);
}

function retireFiles(root: string, desired: DesiredState, previous: PreviousManaged, report: RetireReport): void {
  const desiredKeys = new Set(desired.files.map((file) => fileKey(file.path)));
  for (const [key, old] of previous.files) {
    if (desiredKeys.has(key)) continue;
    const existing = managedHash(root, old.path);
    if (!existing) continue;
    if (existing === old.sha256) {
      removeProjectFile(root, old.path);
      report.removed.push(old.path);
    } else report.preserved.push(`${old.path} (modificado; pertenecía a ${old.owner})`);
    removeStaleSideBySide(root, old.path, old.sha256);
  }
}

function retireBlocks(root: string, desired: DesiredState, previous: PreviousManaged, report: RetireReport): void {
  const desiredKeys = new Set(desired.blocks.map((block) => blockKey(block.path, block.id)));
  for (const [key, old] of previous.blocks) {
    if (desiredKeys.has(key)) continue;
    const text = readText(root, old.path);
    const found = text ? findBlock(text, old.id) : undefined;
    if (!text || !found) continue;
    if (sha256(found.body) !== old.sha256) {
      report.preserved.push(`${old.path}#${old.id} (bloque editado)`);
      continue;
    }
    const next = removeBlock(text, old.id);
    if (next.trim()) writeProjectFile(root, old.path, next);
    else removeProjectFile(root, old.path);
    report.removed.push(`${old.path}#${old.id}`);
  }
}

function retireJson(root: string, desired: DesiredState, previous: PreviousManaged, report: RetireReport): void {
  const desiredKeys = new Set(desired.json.map((entry) => jsonKey(entry.path, entry.pointer)));
  for (const [key, old] of previous.json) {
    if (desiredKeys.has(key)) continue;
    const data = readJson(root, old.path);
    const current = getPointer(data, old.pointer);
    if (current === undefined) continue;
    if (jsonHash(current) !== old.sha256) {
      report.preserved.push(`${old.path}:${old.pointer} (modificado)`);
      continue;
    }
    setPointer(data, old.pointer, undefined);
    pruneEmpty(data);
    if (Object.keys(data).length) writeProjectFile(root, old.path, `${JSON.stringify(data, null, 2)}\n`);
    else removeProjectFile(root, old.path);
    report.removed.push(`${old.path}:${old.pointer}`);
  }
}

export function retireUndesired(root: string, desired: DesiredState, previous: PreviousManaged): RetireReport {
  const report: RetireReport = { removed: [], preserved: [] };
  retireFiles(root, desired, previous, report);
  retireBlocks(root, desired, previous, report);
  retireJson(root, desired, previous, report);
  return report;
}
