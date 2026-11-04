import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isV1Project } from "@modai/core";

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
]);
const MAX_DIRECTORIES = 20_000;
const LOCK_FILE = ".modai/.workspace.lock";
const STALE_LOCK_MS = 15 * 60 * 1000;

export interface DiscoveredProject {
  root: string;
  path: string;
}

function childDirectories(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries
    .sort()
    .filter((name) => !SKIPPED_DIRECTORIES.has(name) && name !== ".modai" && !(name.startsWith(".") && name !== "."))
    .map((name) => join(directory, name))
    .filter((child) => {
      try {
        const info = lstatSync(child);
        return info.isDirectory() && !info.isSymbolicLink();
      } catch {
        return false;
      }
    });
}

export function discoverProjects(
  root: string,
  options: { depth?: number; filter?: string[] } = {},
): DiscoveredProject[] {
  const base = resolve(root);
  if (!statSync(base).isDirectory()) throw new Error(`No es una carpeta: ${base}`);
  const depth = options.depth ?? 4;
  const found: DiscoveredProject[] = [];
  let visited = 0;
  const walk = (directory: string, level: number) => {
    if (++visited > MAX_DIRECTORIES)
      throw new Error(`Hay más de ${MAX_DIRECTORIES} carpetas bajo ${base}; usa una raíz más concreta o --depth menor`);
    if (isV1Project(directory)) found.push({ root: directory, path: relative(base, directory) || "." });
    if (level >= depth) return;
    for (const child of childDirectories(directory)) walk(child, level + 1);
  };
  walk(base, 0);
  const filters = (options.filter ?? []).map((item) => item.toLowerCase());
  return filters.length
    ? found.filter((project) => filters.some((filter) => project.path.toLowerCase().includes(filter)))
    : found;
}

export function acquireLock(root: string): () => void {
  const path = join(root, LOCK_FILE);
  try {
    const age = Date.now() - statSync(path).mtimeMs;
    if (age < STALE_LOCK_MS)
      throw new Error(`otra operación de MODAI está en curso (${LOCK_FILE}); si no es así, borra ese archivo`);
    rmSync(path, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(join(root, ".modai"), { recursive: true });
  writeFileSync(path, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
  return () => {
    try {
      if (readFileSync(path, "utf8").startsWith(`${process.pid} `)) rmSync(path, { force: true });
    } catch {
      return;
    }
  };
}
