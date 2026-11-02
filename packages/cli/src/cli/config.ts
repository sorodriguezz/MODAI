import type { Permission, SignaturePolicy } from "@modai/contracts/types";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { safeProjectPath } from "./safe-path.js";

export interface ClientConfig {
  server: string;
  token?: string;
  signaturePolicy?: SignaturePolicy;
  trustedPublishers?: string[];
}

export interface ProjectManifest {
  schemaVersion: 1;
  projectId: string;
  server?: string;
  packages: Record<string, string>;
  overrides?: Record<string, string>;
  grants?: Permission[];
  signaturePolicy?: SignaturePolicy;
  trustedPublishers?: string[];
}

export interface LockedFile {
  target: string;
  sha256: string;
}

export interface LockedPackage {
  name: string;
  version: string;
  artifactId: string;
  files: LockedFile[];
}

export interface ProjectLock {
  schemaVersion: 1;
  generatedAt: string;
  packages: LockedPackage[];
}

export const clientConfigPath = join(process.env.MODAI_CONFIG_DIR ?? join(homedir(), ".modai"), "client.yaml");

export function readYaml<T>(path: string): T {
  return YAML.parse(readFileSync(path, "utf8")) as T;
}

export function writeYaml(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, YAML.stringify(value, { lineWidth: 0 }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

export function loadClientConfig(): ClientConfig | undefined {
  if (!existsSync(clientConfigPath)) return undefined;
  return readYaml<ClientConfig>(clientConfigPath);
}

export function saveClientConfig(config: ClientConfig): void {
  writeYaml(clientConfigPath, config);
}

export function projectPaths(root = process.cwd()) {
  const projectRoot = resolve(root);
  return {
    root: projectRoot,
    directory: join(projectRoot, ".modai"),
    manifest: safeProjectPath(projectRoot, ".modai/manifest.yaml"),
    lock: safeProjectPath(projectRoot, ".modai/lock.yaml"),
    config: safeProjectPath(projectRoot, ".modai/config.yaml"),
  };
}

export function createManifest(server?: string): ProjectManifest {
  return { schemaVersion: 1, projectId: randomUUID(), server, packages: {}, overrides: {} };
}

export function loadProject(root = process.cwd()): { manifest: ProjectManifest; lock: ProjectLock; paths: ReturnType<typeof projectPaths> } {
  const paths = projectPaths(root);
  if (!existsSync(paths.manifest)) {
    throw new Error(`No es un proyecto ModularAI: falta ${paths.manifest}. Ejecuta 'modai init'.`);
  }
  const manifest = readYaml<ProjectManifest>(paths.manifest);
  const lock = existsSync(paths.lock)
    ? readYaml<ProjectLock>(paths.lock)
    : { schemaVersion: 1 as const, generatedAt: new Date(0).toISOString(), packages: [] };
  return { manifest, lock, paths };
}
