import { AppError } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import type { DesiredState } from "./desired-state.js";
import { getPointer, jsonHash } from "./json-pointer.js";
import { findBlock, managedContentHash } from "./managed-blocks.js";
import { blockKey, fileKey, jsonKey, type PreviousManaged } from "./previous-managed.js";
import { managedHash, readJson, readText } from "./project-files.js";

export const SIDE_BY_SIDE_SUFFIX = ".modai-new";

export function assertPermissionsGranted(desired: DesiredState, grants: string[]): void {
  const granted = new Set(grants);
  const missing = new Set<string>();
  for (const entry of [...desired.files, ...desired.blocks, ...desired.json])
    if (entry.permission && !granted.has(entry.permission)) missing.add(`${entry.permission} (${entry.path})`);
  for (const file of desired.files)
    if (file.executable && !granted.has("process.execute")) missing.add(`process.execute (${file.path})`);
  if (missing.size)
    throw new AppError(
      403,
      "PERMISSION_REQUIRED",
      `La instalación requiere conceder ${[...missing].join(", ")}. Repite con --allow ${[...new Set([...missing].map((item) => item.split(" ")[0]))].join(",")}`,
    );
}

interface ConflictOptions {
  root: string;
  desired: DesiredState;
  previous: PreviousManaged;
  keepMine?: boolean;
  force?: boolean;
}

function fileConflicts(options: ConflictOptions, conflicts: string[], keep: Set<string>): void {
  for (const file of options.desired.files) {
    const existing = managedHash(options.root, file.path);
    const desiredHash = managedContentHash(file.content);
    const old = options.previous.files.get(fileKey(file.path));
    if (!existing || existing === desiredHash || existing === old?.sha256) continue;
    if (old?.userSha256 === existing && old.sha256 === desiredHash) {
      keep.add(fileKey(file.path));
      continue;
    }
    if (options.keepMine && !options.force) keep.add(fileKey(file.path));
    else conflicts.push(`${file.path} contiene cambios tuyos`);
  }
}

function blockConflicts(options: ConflictOptions, conflicts: string[]): void {
  for (const block of options.desired.blocks) {
    const text = readText(options.root, block.path);
    const found = text ? findBlock(text, block.id) : undefined;
    const old = options.previous.blocks.get(blockKey(block.path, block.id));
    if (found && sha256(found.body) !== sha256(block.content) && sha256(found.body) !== old?.sha256)
      conflicts.push(`el bloque MODAI '${block.id}' de ${block.path} fue editado a mano`);
  }
}

function jsonConflicts(options: ConflictOptions, conflicts: string[]): void {
  for (const entry of options.desired.json) {
    const current = getPointer(readJson(options.root, entry.path), entry.pointer);
    const old = options.previous.json.get(jsonKey(entry.path, entry.pointer));
    if (current !== undefined && jsonHash(current) !== jsonHash(entry.value) && jsonHash(current) !== old?.sha256)
      conflicts.push(`${entry.path}:${entry.pointer} fue modificado a mano`);
  }
}

export function resolveConflicts(options: ConflictOptions): Set<string> {
  const conflicts: string[] = [];
  const keep = new Set<string>();
  fileConflicts(options, conflicts, keep);
  blockConflicts(options, conflicts);
  jsonConflicts(options, conflicts);
  if (conflicts.length && !options.force)
    throw new AppError(
      409,
      "MANAGED_CONFLICT",
      `Conflicto: ${conflicts.join("; ")}. Repite con --keep-mine para conservar tus archivos (la versión nueva queda al lado como${SIDE_BY_SIDE_SUFFIX}) o con --force para reemplazarlos.`,
    );
  return keep;
}
