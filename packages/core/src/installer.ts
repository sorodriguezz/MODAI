import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppError } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import type { AnyPackageManifest, ArtifactFile } from "@modai/contracts/types";
import type { ManagedEntry } from "@modai/contracts/spec-v1";
import type { DesiredBlock, DesiredJson, DesiredState } from "./adapters.js";
import { removeProjectDirectory, removeProjectFile, safeProjectPath, writeProjectFile } from "./fs.js";
import { computeIntegrity } from "./integrity.js";

const BEGIN = (id: string) => `<!-- modai:begin ${id} -->`;
const END = (id: string) => `<!-- modai:end ${id} -->`;

function readText(root: string, path: string): string | undefined {
  const absolute = safeProjectPath(root, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
}
function currentHash(root: string, path: string): string | undefined {
  const absolute = safeProjectPath(root, path);
  return existsSync(absolute) ? sha256(readFileSync(absolute)) : undefined;
}

const BLOCK_PATTERN = /\n*<!-- modai:begin ([^ ]+) -->[\s\S]*?<!-- modai:end \1 -->\n*/g;
/**
 * Hash of a managed file ignoring MODAI's own blocks. A package may own a whole file (a harness
 * shipping AGENTS.md) while an adapter keeps a block inside it; neither is a user change.
 */
export function managedContentHash(content: Buffer): string {
  if (!content.includes("<!-- modai:begin ")) return sha256(content);
  return sha256(content.toString("utf8").replace(BLOCK_PATTERN, "\n").replace(/^\n+/, "").replace(/\n+$/, "\n"));
}
function managedHash(root: string, path: string): string | undefined {
  const absolute = safeProjectPath(root, path);
  return existsSync(absolute) ? managedContentHash(readFileSync(absolute)) : undefined;
}

export function findBlock(content: string, id: string): { start: number; end: number; body: string } | undefined {
  const start = content.indexOf(BEGIN(id));
  const endMarker = content.indexOf(END(id));
  if (start < 0 && endMarker < 0) return undefined;
  if (start < 0 || endMarker < start) throw new AppError(409, "BLOCK_CORRUPT", `Bloque MODAI '${id}' incompleto`);
  const end = endMarker + END(id).length;
  return { start, end, body: content.slice(start + BEGIN(id).length, endMarker).replace(/^\n/, "").replace(/\n$/, "") };
}
function renderBlock(id: string, body: string): string { return `${BEGIN(id)}\n${body}\n${END(id)}`; }
function upsertBlock(content: string, id: string, body: string): string {
  const block = findBlock(content, id);
  if (block) return content.slice(0, block.start) + renderBlock(id, body) + content.slice(block.end);
  return `${content}${content && !content.endsWith("\n") ? "\n" : ""}${content ? "\n" : ""}${renderBlock(id, body)}\n`;
}
function removeBlock(content: string, id: string): string {
  const block = findBlock(content, id);
  if (!block) return content;
  return (content.slice(0, block.start).replace(/\n+$/, "\n") + content.slice(block.end).replace(/^\n+/, "")).replace(/^\n+/, "");
}

function getPointer(value: unknown, pointer: string): unknown {
  return pointer.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), value);
}
function setPointer(value: Record<string, unknown>, pointer: string, next: unknown): void {
  const keys = pointer.split(".");
  let node = value;
  for (const key of keys.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== "object" || Array.isArray(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  if (next === undefined) delete node[keys.at(-1)!]; else node[keys.at(-1)!] = next;
}
function readJson(root: string, path: string): Record<string, unknown> {
  const text = readText(root, path);
  if (!text?.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new AppError(409, "JSON_CONFLICT", `${path} no es un objeto JSON válido; corrígelo antes de sincronizar`); }
}
const jsonHash = (value: unknown) => sha256(JSON.stringify(value ?? null));

export interface ApplyOptions {
  root: string; previous: ManagedEntry[]; desired: DesiredState; grants: string[]; force?: boolean;
  /** On a conflicting file, keep the user's version and write MODAI's next to it as <file>.modai-new. */
  keepMine?: boolean;
}
export interface ApplyResult { managed: ManagedEntry[]; written: string[]; removed: string[]; preserved: string[]; sideBySide: string[] }
export const SIDE_BY_SIDE_SUFFIX = ".modai-new";

/**
 * Converges the project to the desired state. Every write is recorded with its hash so a later
 * removal only deletes what MODAI wrote; anything the user changed is preserved and reported.
 */
export function applyDesiredState(options: ApplyOptions): ApplyResult {
  const { root, previous, desired, force } = options;
  const granted = new Set(options.grants);
  const missing = new Set<string>();
  for (const entry of [...desired.files, ...desired.blocks, ...desired.json]) if (entry.permission && !granted.has(entry.permission)) missing.add(`${entry.permission} (${entry.path})`);
  // Writing an executable file is consent to run code later: it needs the same explicit grant.
  for (const file of desired.files) if (file.executable && !granted.has("process.execute")) missing.add(`process.execute (${file.path})`);
  if (missing.size) throw new AppError(403, "PERMISSION_REQUIRED", `La instalación requiere conceder ${[...missing].join(", ")}. Repite con --allow ${[...new Set([...missing].map(item => item.split(" ")[0]))].join(",")}`);

  const previousFiles = new Map(previous.filter(entry => entry.type === "file").map(entry => [entry.path.toLowerCase(), entry]));
  const previousBlocks = new Map(previous.filter(entry => entry.type === "block").map(entry => [`${entry.path.toLowerCase()}#${entry.id}`, entry]));
  const previousJson = new Map(previous.filter(entry => entry.type === "json").map(entry => [`${entry.path.toLowerCase()}#${entry.pointer}`, entry]));

  // 1. Detect conflicts before touching anything.
  const conflicts: string[] = [];
  const keep = new Set<string>();
  for (const file of desired.files) {
    const existing = managedHash(root, file.path);
    const desiredHash = managedContentHash(file.content);
    const old = previousFiles.get(file.path.toLowerCase());
    if (!existing || existing === desiredHash || existing === old?.sha256) continue;
    // The user already kept their version of this exact content: nothing new to decide.
    if (old?.type === "file" && old.userSha256 === existing && old.sha256 === desiredHash) { keep.add(file.path.toLowerCase()); continue; }
    if (options.keepMine && !force) keep.add(file.path.toLowerCase());
    else conflicts.push(`${file.path} contiene cambios tuyos`);
  }
  for (const block of desired.blocks) {
    const text = readText(root, block.path);
    const found = text ? findBlock(text, block.id) : undefined;
    const old = previousBlocks.get(`${block.path.toLowerCase()}#${block.id}`);
    if (found && sha256(found.body) !== sha256(block.content) && sha256(found.body) !== old?.sha256) conflicts.push(`el bloque MODAI '${block.id}' de ${block.path} fue editado a mano`);
  }
  for (const entry of desired.json) {
    const current = getPointer(readJson(root, entry.path), entry.pointer);
    const old = previousJson.get(`${entry.path.toLowerCase()}#${entry.pointer}`);
    if (current !== undefined && jsonHash(current) !== jsonHash(entry.value) && jsonHash(current) !== old?.sha256) conflicts.push(`${entry.path}:${entry.pointer} fue modificado a mano`);
  }
  if (conflicts.length && !force) throw new AppError(409, "MANAGED_CONFLICT", `Conflicto: ${conflicts.join("; ")}. Repite con --keep-mine para conservar tus archivos (la versión nueva queda al lado como${SIDE_BY_SIDE_SUFFIX}) o con --force para reemplazarlos.`);

  const written: string[] = [], removed: string[] = [], preserved: string[] = [], sideBySide: string[] = [];
  const desiredFileKeys = new Set(desired.files.map(file => file.path.toLowerCase()));
  const desiredBlockKeys = new Set(desired.blocks.map(block => `${block.path.toLowerCase()}#${block.id}`));
  const desiredJsonKeys = new Set(desired.json.map(entry => `${entry.path.toLowerCase()}#${entry.pointer}`));

  // 2. Retire what is no longer desired, preserving user modifications.
  for (const [key, old] of previousFiles) {
    if (desiredFileKeys.has(key) || old.type !== "file") continue;
    const existing = managedHash(root, old.path);
    if (!existing) continue;
    if (existing === old.sha256) { removeProjectFile(root, old.path); removed.push(old.path); }
    else preserved.push(`${old.path} (modificado; pertenecía a ${old.owner})`);
    removeStaleSideBySide(root, old.path, old.sha256);
  }
  for (const [key, old] of previousBlocks) {
    if (desiredBlockKeys.has(key) || old.type !== "block") continue;
    const text = readText(root, old.path);
    const found = text ? findBlock(text, old.id) : undefined;
    if (!text || !found) continue;
    if (sha256(found.body) !== old.sha256) { preserved.push(`${old.path}#${old.id} (bloque editado)`); continue; }
    const next = removeBlock(text, old.id);
    if (next.trim()) writeProjectFile(root, old.path, next); else removeProjectFile(root, old.path);
    removed.push(`${old.path}#${old.id}`);
  }
  for (const [key, old] of previousJson) {
    if (desiredJsonKeys.has(key) || old.type !== "json") continue;
    const data = readJson(root, old.path);
    const current = getPointer(data, old.pointer);
    if (current === undefined) continue;
    if (jsonHash(current) !== old.sha256) { preserved.push(`${old.path}:${old.pointer} (modificado)`); continue; }
    setPointer(data, old.pointer, undefined);
    pruneEmpty(data);
    if (Object.keys(data).length) writeProjectFile(root, old.path, `${JSON.stringify(data, null, 2)}\n`); else removeProjectFile(root, old.path);
    removed.push(`${old.path}:${old.pointer}`);
  }

  // 3. Write the desired state.
  const managed: ManagedEntry[] = [];
  for (const file of desired.files) {
    const hash = managedContentHash(file.content);
    const entry: ManagedEntry = { type: "file", path: file.path, sha256: hash, owner: file.owner, ...(file.adapter ? { adapter: file.adapter } : {}) };
    if (keep.has(file.path.toLowerCase())) {
      const mine = managedHash(root, file.path)!;
      const old = previousFiles.get(file.path.toLowerCase());
      // New upstream content the user has not seen yet goes next to their file.
      if (!(old?.type === "file" && old.userSha256 === mine && old.sha256 === hash)) {
        writeProjectFile(root, `${file.path}${SIDE_BY_SIDE_SUFFIX}`, file.content);
        sideBySide.push(`${file.path}${SIDE_BY_SIDE_SUFFIX}`);
      }
      managed.push({ ...entry, userSha256: mine });
      continue;
    }
    if (managedHash(root, file.path) !== hash) { writeProjectFile(root, file.path, file.content, file.executable); written.push(file.path); }
    removeStaleSideBySide(root, file.path, hash);
    managed.push(entry);
  }
  const blocksByFile = new Map<string, DesiredBlock[]>();
  for (const block of desired.blocks) blocksByFile.set(block.path, [...(blocksByFile.get(block.path) ?? []), block]);
  for (const [path, list] of blocksByFile) {
    const before = readText(root, path) ?? "";
    let text = before;
    for (const block of list) {
      text = upsertBlock(text, block.id, block.content);
      managed.push({ type: "block", path, id: block.id, sha256: sha256(block.content), owners: block.owners, adapter: block.adapter });
    }
    if (text !== before) { writeProjectFile(root, path, text); written.push(path); }
  }
  const jsonByFile = new Map<string, DesiredJson[]>();
  for (const entry of desired.json) jsonByFile.set(entry.path, [...(jsonByFile.get(entry.path) ?? []), entry]);
  for (const [path, list] of jsonByFile) {
    const data = readJson(root, path);
    const before = JSON.stringify(data);
    for (const entry of list) {
      setPointer(data, entry.pointer, entry.value);
      managed.push({ type: "json", path, pointer: entry.pointer, sha256: jsonHash(entry.value), adapter: entry.adapter });
    }
    if (JSON.stringify(data) !== before || !readText(root, path)) { writeProjectFile(root, path, `${JSON.stringify(data, null, 2)}\n`); written.push(path); }
  }
  managed.sort((a, b) => `${a.path}#${a.type}`.localeCompare(`${b.path}#${b.type}`));
  return { managed, written, removed, preserved, sideBySide };
}

/** Deletes <file>.modai-new once it is obsolete, only if it still holds the content MODAI wrote. */
function removeStaleSideBySide(root: string, path: string, hash: string): void {
  const side = `${path}${SIDE_BY_SIDE_SUFFIX}`;
  if (currentHash(root, side) === hash) removeProjectFile(root, side);
}

function pruneEmpty(value: Record<string, unknown>): void {
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      pruneEmpty(child as Record<string, unknown>);
      if (!Object.keys(child).length) delete value[key];
    }
  }
}

// ---------------------------------------------------------------------------
// Package store: .modai/store/@scope/name — the extracted, verifiable copy of each package.
// It is a cache rebuilt from modai.lock + registries and should not be committed.
// ---------------------------------------------------------------------------

export const STORE_DIRECTORY = ".modai/store";
export function storePath(name: string): string { return `${STORE_DIRECTORY}/${name}`; }
export function storePackageDir(root: string, name: string): string { return join(dirname(safeProjectPath(root, `${storePath(name)}/package.json`)), "files"); }

interface StoreRecord { name: string; version: string; integrity: string; manifest: AnyPackageManifest; files: Array<{ path: string; sha256: string }> }

export function readStoreRecord(root: string, name: string): StoreRecord | undefined {
  const text = readText(root, `${storePath(name)}/package.json`);
  return text ? JSON.parse(text) as StoreRecord : undefined;
}

export function writeStore(root: string, artifact: { name: string; version: string; integrity: string; manifest: AnyPackageManifest; files: ArtifactFile[] }): void {
  const existing = readStoreRecord(root, artifact.name);
  if (existing?.integrity === artifact.integrity && verifyStore(root, artifact.name, artifact.integrity)) return;
  removeProjectDirectory(root, storePath(artifact.name));
  for (const file of artifact.files) writeProjectFile(root, `${storePath(artifact.name)}/files/${file.path}`, Buffer.from(file.content, "base64"));
  const record: StoreRecord = { name: artifact.name, version: artifact.version, integrity: artifact.integrity, manifest: artifact.manifest, files: artifact.files.map(({ path, sha256: hash }) => ({ path, sha256: hash })) };
  writeProjectFile(root, `${storePath(artifact.name)}/package.json`, `${JSON.stringify(record, null, 2)}\n`);
}

/** Recomputes the integrity of an extracted package. Executable contributions are refused if it differs from the lock. */
export function verifyStore(root: string, name: string, integrity: string): boolean {
  const record = readStoreRecord(root, name);
  if (!record || record.integrity !== integrity) return false;
  try {
    const files = record.files.map(file => ({ path: file.path, sha256: currentHash(root, `${storePath(name)}/files/${file.path}`) ?? "" }));
    if (files.some((file, index) => file.sha256 !== record.files[index].sha256)) return false;
    return computeIntegrity(record.manifest, files) === integrity;
  } catch { return false; }
}

export function readStoreFile(root: string, name: string, path: string): Buffer {
  return readFileSync(safeProjectPath(root, `${storePath(name)}/files/${path}`));
}

export function pruneStore(root: string, keep: Set<string>): string[] {
  const base = dirname(safeProjectPath(root, `${STORE_DIRECTORY}/.keep`));
  if (!existsSync(base)) return [];
  const removed: string[] = [];
  for (const scope of readdirSync(base).filter(entry => entry.startsWith("@"))) {
    for (const short of readdirSync(join(base, scope))) {
      const name = `${scope}/${short}`;
      if (!keep.has(name)) { removeProjectDirectory(root, storePath(name)); removed.push(name); }
    }
  }
  return removed;
}
