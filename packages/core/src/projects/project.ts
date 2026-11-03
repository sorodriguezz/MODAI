import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AppError } from "@modai/contracts/errors";
import {
  API_VERSION,
  type LockFile,
  lockFileSchema,
  type ProjectFile,
  projectFileSchema,
} from "@modai/contracts/manifest";
import YAML from "yaml";
import { safeProjectPath, writeProjectFile } from "../installation/fs.js";

export const PROJECT_FILE = "modai.yaml";
export const LOCK_FILE = "modai.lock";

export function configDirectory(): string {
  return process.env.MODAI_CONFIG_DIR ?? join(homedir(), ".modai");
}

export function isV1Project(root: string): boolean {
  return existsSync(join(resolve(root), PROJECT_FILE));
}

export function emptyLock(): LockFile {
  return { lockfileVersion: 1, packages: {}, capabilities: {}, managed: [] };
}

export function createProjectFile(name: string, options: Partial<ProjectFile> = {}): ProjectFile {
  return projectFileSchema.parse({ apiVersion: API_VERSION, kind: "Project", name, ...options });
}

function parse<T>(
  path: string,
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  },
): T {
  const result = schema.safeParse(YAML.parse(readFileSync(path, "utf8")) ?? {});
  if (!result.success)
    throw new AppError(
      400,
      "INVALID_PROJECT_FILE",
      `${path}: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  return result.data;
}

export interface V1Project {
  root: string;
  file: ProjectFile;
  lock: LockFile;
}

export function loadV1Project(root = process.cwd()): V1Project {
  const projectRoot = resolve(root);
  const path = safeProjectPath(projectRoot, PROJECT_FILE);
  if (!existsSync(path))
    throw new AppError(404, "NOT_A_PROJECT", `No es un proyecto MODAI: falta ${path}. Ejecuta 'modai init'.`);
  const lockPath = safeProjectPath(projectRoot, LOCK_FILE);
  return {
    root: projectRoot,
    file: parse(path, projectFileSchema),
    lock: existsSync(lockPath) ? parse(lockPath, lockFileSchema) : emptyLock(),
  };
}

function sortKeys<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

export function saveProjectFile(root: string, file: ProjectFile): void {
  const features = sortKeys(
    Object.fromEntries(
      Object.entries(file.features)
        .filter(([, choice]) => Object.keys(choice).length)
        .map(([name, choice]) => [name, sortKeys(choice)]),
    ),
  );
  const { apiVersion, kind, name, registries, dependencies, features: _features, overrides, providers, ...rest } = file;
  const clean = {
    apiVersion,
    kind,
    name,
    registries,
    dependencies: sortKeys(dependencies),
    ...(Object.keys(features).length ? { features } : {}),
    overrides: sortKeys(overrides),
    providers: sortKeys(providers),
    ...rest,
  };
  writeProjectFile(
    root,
    PROJECT_FILE,
    `# Proyecto MODAI. Edita dependencias con 'modai add/remove'; la especificación está en docs/spec/PACKAGE-SPEC-v1.md\n${YAML.stringify(clean, { lineWidth: 0 })}`,
  );
}

export function saveLock(root: string, lock: LockFile): void {
  const clean: LockFile = {
    lockfileVersion: 1,
    packages: sortKeys(lock.packages),
    capabilities: sortKeys(lock.capabilities),
    managed: lock.managed,
  };
  writeProjectFile(
    root,
    LOCK_FILE,
    `# Generado por MODAI. No editar: reconstruye exactamente el entorno con 'modai sync'.\n${YAML.stringify(clean, { lineWidth: 0 })}`,
  );
}

export function ensureProjectGitignore(root: string): void {
  const path = safeProjectPath(root, ".modai/.gitignore");
  if (!existsSync(path))
    writeProjectFile(root, ".modai/.gitignore", "# Caché reconstruible con 'modai sync'\nstore/\ncontext-index.json\n");
}
