import { lstatSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { assertSafeRelativePath } from "@modai/contracts/security";
import { safeProjectPath } from "../installation/fs.js";

const IGNORED = new Set([".DS_Store", "Thumbs.db", ".git", "node_modules"]);

export function listPackageFiles(root: string, relative: string): string[] {
  assertSafeRelativePath(relative, "path");
  const absolute = safeProjectPath(root, relative, false, true);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos en paquetes: ${relative}`);
  if (info.isFile()) return [relative.replaceAll("\\", "/")];
  if (!info.isDirectory()) return [];
  return readdirSync(absolute)
    .filter((name) => !IGNORED.has(name))
    .sort()
    .flatMap((name) => listPackageFiles(root, posix.join(relative.replaceAll("\\", "/"), name)));
}
