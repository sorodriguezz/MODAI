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
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { assertSafeRelativePath } from "@modai/contracts/security";

export function safeProjectPath(root: string, target: string, createParents = false, allowDirectory = false): string {
  assertSafeRelativePath(target, "target");
  const canonicalRoot = realpathSync(root),
    path = resolve(canonicalRoot, target);
  const relation = relative(canonicalRoot, path);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`))
    throw new Error(`Ruta fuera del proyecto: ${target}`);
  let current = canonicalRoot;
  const segments = relation.split(sep);
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!info && createParents && index < segments.length - 1) {
      mkdirSync(current);
      info = lstatSync(current);
    }
    if (info?.isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos en ${target}`);
    if (info && index < segments.length - 1 && !info.isDirectory())
      throw new Error(`El padre no es un directorio: ${target}`);
    if (info && index === segments.length - 1 && !info.isFile() && !(allowDirectory && info.isDirectory()))
      throw new Error(`El destino no es un archivo: ${target}`);
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

/** Removes a managed file and prunes now-empty parent directories, never climbing above the project root. */
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

/** Removes a directory tree inside the project after validating that no segment is a symlink. */
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
