import type { ManagedEntry } from "@modai/contracts/manifest";
import { sha256 } from "@modai/contracts/security";
import { SIDE_BY_SIDE_SUFFIX } from "./apply-conflicts.js";
import type { DesiredBlock, DesiredFile, DesiredJson, DesiredState } from "./desired-state.js";
import { writeProjectFile } from "./fs.js";
import { jsonHash, setPointer } from "./json-pointer.js";
import { managedContentHash, upsertBlock } from "./managed-blocks.js";
import { fileKey, type PreviousManaged } from "./previous-managed.js";
import { managedHash, readJson, readText } from "./project-files.js";
import { removeStaleSideBySide } from "./retire-managed.js";

export interface WriteReport {
  managed: ManagedEntry[];
  written: string[];
  sideBySide: string[];
}

interface WriteContext {
  root: string;
  previous: PreviousManaged;
  keep: Set<string>;
  report: WriteReport;
}

function keepUserFile(context: WriteContext, file: DesiredFile, entry: ManagedEntry, hash: string): void {
  const { root, report } = context;
  const mine = managedHash(root, file.path)!;
  const old = context.previous.files.get(fileKey(file.path));
  if (!(old?.userSha256 === mine && old.sha256 === hash)) {
    writeProjectFile(root, `${file.path}${SIDE_BY_SIDE_SUFFIX}`, file.content);
    report.sideBySide.push(`${file.path}${SIDE_BY_SIDE_SUFFIX}`);
  }
  report.managed.push({ ...entry, userSha256: mine } as ManagedEntry);
}

function writeFiles(context: WriteContext, files: DesiredFile[]): void {
  const { root, report } = context;
  for (const file of files) {
    const hash = managedContentHash(file.content);
    const entry: ManagedEntry = {
      type: "file",
      path: file.path,
      sha256: hash,
      owner: file.owner,
      ...(file.adapter ? { adapter: file.adapter } : {}),
    };
    if (context.keep.has(fileKey(file.path))) {
      keepUserFile(context, file, entry, hash);
      continue;
    }
    if (managedHash(root, file.path) !== hash) {
      writeProjectFile(root, file.path, file.content, file.executable);
      report.written.push(file.path);
    }
    removeStaleSideBySide(root, file.path, hash);
    report.managed.push(entry);
  }
}

function groupByPath<T extends { path: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.path, [...(groups.get(item.path) ?? []), item]);
  return groups;
}

function writeBlocks(context: WriteContext, blocks: DesiredBlock[]): void {
  const { root, report } = context;
  for (const [path, list] of groupByPath(blocks)) {
    const before = readText(root, path) ?? "";
    let text = before;
    for (const block of list) {
      text = upsertBlock(text, block.id, block.content);
      report.managed.push({
        type: "block",
        path,
        id: block.id,
        sha256: sha256(block.content),
        owners: block.owners,
        adapter: block.adapter,
      });
    }
    if (text !== before) {
      writeProjectFile(root, path, text);
      report.written.push(path);
    }
  }
}

function writeJson(context: WriteContext, entries: DesiredJson[]): void {
  const { root, report } = context;
  for (const [path, list] of groupByPath(entries)) {
    const data = readJson(root, path);
    const before = JSON.stringify(data);
    for (const entry of list) {
      setPointer(data, entry.pointer, entry.value);
      report.managed.push({
        type: "json",
        path,
        pointer: entry.pointer,
        sha256: jsonHash(entry.value),
        adapter: entry.adapter,
      });
    }
    if (JSON.stringify(data) !== before || !readText(root, path)) {
      writeProjectFile(root, path, `${JSON.stringify(data, null, 2)}\n`);
      report.written.push(path);
    }
  }
}

export function writeDesired(
  root: string,
  desired: DesiredState,
  previous: PreviousManaged,
  keep: Set<string>,
): WriteReport {
  const context: WriteContext = { root, previous, keep, report: { managed: [], written: [], sideBySide: [] } };
  writeFiles(context, desired.files);
  writeBlocks(context, desired.blocks);
  writeJson(context, desired.json);
  context.report.managed.sort((a, b) => `${a.path}#${a.type}`.localeCompare(`${b.path}#${b.type}`));
  return context.report;
}
