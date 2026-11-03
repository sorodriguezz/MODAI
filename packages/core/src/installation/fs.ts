import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { assertSafeRelativePath } from "@modai/contracts/security";

function existingEntry(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

function assertEntryKind(info: Stats, isLast: boolean, allowDirectory: boolean, target: string): void {
  if (info.isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos en ${target}`);
  if (!isLast && !info.isDirectory()) throw new Error(`El padre no es un directorio: ${target}`);
  if (isLast && !info.isFile() && !(allowDirectory && info.isDirectory()))
    throw new Error(`El destino no es un archivo: ${target}`);
}

export function safeProjectPath(root: string, target: string, createParents = false, allowDirectory = false): string {
  assertSafeRelativePath(target, "target");
  const canonicalRoot = realpathSync(root);
  const path = resolve(canonicalRoot, target);
  const relation = relative(canonicalRoot, path);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`))
    throw new Error(`Ruta fuera del proyecto: ${target}`);
  let current = canonicalRoot;
  const segments = relation.split(sep);
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    const isLast = index === segments.length - 1;
    let info = existingEntry(current);
    if (!info && createParents && !isLast) {
      mkdirSync(current);
      info = lstatSync(current);
    }
    if (info) assertEntryKind(info, isLast, allowDirectory, target);
  }
  return path;
}

export function writeProjectFile(root: string, target: string, content: string | Buffer, executable = false): void {
  const path = safeProjectPath(root, target, true);
  const temporary = join(dirname(path), `.modai-${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      executable ? 0o755 : 0o600,
    );
    writeFileSync(descriptor, content);
    closeSync(descriptor);
    descriptor = undefined;
    safeProjectPath(root, target);
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export function removeProjectFile(root: string, target: string): void {
  const path = safeProjectPath(root, target);
  rmSync(path, { force: true });
  const canonicalRoot = realpathSync(root);
  let current = dirname(path);
  while (current.startsWith(canonicalRoot + sep) && current !== canonicalRoot) {
    try {
      if (readdirSync(current).length) break;
      rmdirSync(current);
    } catch {
      break;
    }
    current = dirname(current);
  }
}

export function removeProjectDirectory(root: string, target: string): void {
  assertSafeRelativePath(target, "target");
  const canonicalRoot = realpathSync(root),
    path = resolve(canonicalRoot, target);
  const relation = relative(canonicalRoot, path);
  if (!relation || relation.startsWith("..")) throw new Error(`Ruta fuera del proyecto: ${target}`);
  let current = canonicalRoot;
  for (const segment of relation.split(sep)) {
    current = join(current, segment);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos en ${target}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
  rmSync(path, { recursive: true, force: true });
}
