import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDirectory } from "./project.js";

export interface PackageGrant {
  integrity: string;
  permissions: string[];
  features?: string[];
  grantedAt: string;
}
export interface ProjectGrants {
  install: string[];
  packages: Record<string, PackageGrant>;
}

function grantsPath(): string {
  return join(configDirectory(), "grants-v1.json");
}
function projectKey(root: string): string {
  return createHash("sha256").update(realpathSync(root)).digest("hex");
}
function readAllGrants(): Record<string, ProjectGrants> {
  const path = grantsPath();
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, ProjectGrants>) : {};
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
