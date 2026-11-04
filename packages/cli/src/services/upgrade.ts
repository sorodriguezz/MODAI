import { type SpawnSyncOptions, type SpawnSyncReturns, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { sep } from "node:path";

export const CLI_PACKAGE = "@sorodriguez/modai";

function registryUrl(): string {
  return (process.env.MODAI_NPM_REGISTRY ?? process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(
    /\/+$/,
    "",
  );
}

export async function fetchDistTag(tag = "latest", timeoutMs = 5000): Promise<string> {
  const response = await fetch(`${registryUrl()}/-/package/${CLI_PACKAGE.replace("/", "%2f")}/dist-tags`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`El registry de npm respondió ${response.status}`);
  const tags = (await response.json()) as Record<string, string>;
  if (!tags[tag])
    throw new Error(`No existe la etiqueta "${tag}" para ${CLI_PACKAGE}. Disponibles: ${Object.keys(tags).join(", ")}`);
  return tags[tag];
}

export type InstallKind = "npm" | "pnpm" | "yarn" | "bun" | "npx" | "source";
export type Install = { kind: InstallKind; command?: string[] };

function realEntry(entry: string): string {
  try {
    return realpathSync(entry);
  } catch {
    return entry;
  }
}

function managerInstall(normalized: string): Install | undefined {
  if (/\/_npx\//.test(normalized)) return { kind: "npx" };
  if (/\/pnpm\//i.test(normalized) || /\/\.pnpm\//.test(normalized))
    return { kind: "pnpm", command: ["pnpm", "add", "-g"] };
  if (/\/\.bun\//.test(normalized)) return { kind: "bun", command: ["bun", "add", "-g"] };
  if (/\/yarn\/global\//i.test(normalized) || /\/\.config\/yarn\//.test(normalized))
    return { kind: "yarn", command: ["yarn", "global", "add"] };
  return undefined;
}

export function detectInstall(entry = process.argv[1], globalRoot = npmGlobalRoot): Install {
  const normalized = realEntry(entry).split(sep).join("/");
  if (!normalized.includes(`/node_modules/${CLI_PACKAGE}/`)) return { kind: "source" };
  const manager = managerInstall(normalized);
  if (manager) return manager;
  const root = globalRoot();
  if (root && normalized.startsWith(`${root.split(sep).join("/")}/`))
    return { kind: "npm", command: ["npm", "install", "-g"] };
  return { kind: "source" };
}

function npmGlobalRoot(): string | undefined {
  const result = runPackageManager("npm", ["root", "-g"], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout).trim() : undefined;
}

export function runPackageManager(
  binary: string,
  args: string[],
  options: SpawnSyncOptions = {},
): SpawnSyncReturns<string | Buffer> {
  return process.platform === "win32"
    ? spawnSync([binary, ...args].join(" "), { ...options, shell: true })
    : spawnSync(binary, args, options);
}
