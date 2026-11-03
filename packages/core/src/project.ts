import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { AppError } from "@modai/contracts/errors";
import { API_VERSION, lockFileSchema, projectFileSchema, type LockFile, type ProjectFile } from "@modai/contracts/spec-v1";
import { safeProjectPath, writeProjectFile } from "./fs.js";

export const PROJECT_FILE = "modai.yaml";
export const LOCK_FILE = "modai.lock";

export function configDirectory(): string { return process.env.MODAI_CONFIG_DIR ?? join(homedir(), ".modai"); }

export function isV1Project(root: string): boolean { return existsSync(join(resolve(root), PROJECT_FILE)); }

export function emptyLock(): LockFile { return { lockfileVersion: 1, packages: {}, capabilities: {}, managed: [] }; }

export function createProjectFile(name: string, options: Partial<ProjectFile> = {}): ProjectFile {
  return projectFileSchema.parse({ apiVersion: API_VERSION, kind: "Project", name, ...options });
}

function parse<T>(path: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }): T {
  const result = schema.safeParse(YAML.parse(readFileSync(path, "utf8")) ?? {});
  if (!result.success) throw new AppError(400, "INVALID_PROJECT_FILE", `${path}: ${result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  return result.data;
}

export interface V1Project { root: string; file: ProjectFile; lock: LockFile }

export function loadV1Project(root = process.cwd()): V1Project {
  const projectRoot = resolve(root);
  const path = safeProjectPath(projectRoot, PROJECT_FILE);
  if (!existsSync(path)) throw new AppError(404, "NOT_A_PROJECT", `No es un proyecto MODAI: falta ${path}. Ejecuta 'modai init'.`);
  const lockPath = safeProjectPath(projectRoot, LOCK_FILE);
  return { root: projectRoot, file: parse(path, projectFileSchema), lock: existsSync(lockPath) ? parse(lockPath, lockFileSchema) : emptyLock() };
}

function sortKeys<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

export function saveProjectFile(root: string, file: ProjectFile): void {
  // Empty feature choices are noise: a package without an entry simply follows its defaults.
  const features = sortKeys(Object.fromEntries(Object.entries(file.features).filter(([, choice]) => Object.keys(choice).length).map(([name, choice]) => [name, sortKeys(choice)])));
  const { apiVersion, kind, name, registries, dependencies, features: _features, overrides, providers, ...rest } = file;
  // Feature choices sit next to the dependencies they refine.
  const clean = { apiVersion, kind, name, registries, dependencies: sortKeys(dependencies), ...(Object.keys(features).length ? { features } : {}), overrides: sortKeys(overrides), providers: sortKeys(providers), ...rest };
  writeProjectFile(root, PROJECT_FILE, `# Proyecto MODAI. Edita dependencias con 'modai add/remove'; la especificación está en docs/spec/PACKAGE-SPEC-v1.md\n${YAML.stringify(clean, { lineWidth: 0 })}`);
}

/** The lock is deterministic (no timestamps) so that identical inputs produce identical files. */
export function saveLock(root: string, lock: LockFile): void {
  const clean: LockFile = { lockfileVersion: 1, packages: sortKeys(lock.packages), capabilities: sortKeys(lock.capabilities), managed: lock.managed };
  writeProjectFile(root, LOCK_FILE, `# Generado por MODAI. No editar: reconstruye exactamente el entorno con 'modai sync'.\n${YAML.stringify(clean, { lineWidth: 0 })}`);
}

export function ensureProjectGitignore(root: string): void {
  const path = safeProjectPath(root, ".modai/.gitignore");
  if (!existsSync(path)) writeProjectFile(root, ".modai/.gitignore", "# Caché reconstruible con 'modai sync'\nstore/\ncontext-index.json\n");
}

// ---------------------------------------------------------------------------
// Machine-local grants. Repository files can request permissions; only the person operating
// this machine can grant them. Grants never travel with the project.
// ---------------------------------------------------------------------------

/** `features`: the features applied when it was granted; switching features on or off needs a new grant. */
export interface PackageGrant { integrity: string; permissions: string[]; features?: string[]; grantedAt: string }
export interface ProjectGrants { install: string[]; packages: Record<string, PackageGrant> }

function grantsPath(): string { return join(configDirectory(), "grants-v1.json"); }
function projectKey(root: string): string { return createHash("sha256").update(realpathSync(root)).digest("hex"); }
function readAllGrants(): Record<string, ProjectGrants> {
  const path = grantsPath();
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, ProjectGrants> : {};
}

export function loadGrants(root: string): ProjectGrants {
  return readAllGrants()[projectKey(root)] ?? { install: [], packages: {} };
}

export function saveGrants(root: string, grants: ProjectGrants): void {
  const all = readAllGrants();
  all[projectKey(root)] = grants;
  const path = grantsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}
