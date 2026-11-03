import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import type { Command } from "commander";
import semver from "semver";
import { configDirectory } from "@modai/core";
import { confirm } from "../v1/runtime.js";

export const CLI_PACKAGE = "@sorodriguez/modai";
const DAY_MS = 24 * 60 * 60 * 1000;
type Print = (value: unknown) => void;

function registryUrl(): string {
  return (process.env.MODAI_NPM_REGISTRY ?? process.env.npm_config_registry ?? "https://registry.npmjs.org").replace(/\/+$/, "");
}

/** Version published under a dist-tag (latest, next…), read straight from the npm registry. */
export async function fetchDistTag(tag = "latest", timeoutMs = 5000): Promise<string> {
  const response = await fetch(`${registryUrl()}/-/package/${CLI_PACKAGE.replace("/", "%2f")}/dist-tags`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`El registry de npm respondió ${response.status}`);
  const tags = await response.json() as Record<string, string>;
  if (!tags[tag]) throw new Error(`No existe la etiqueta "${tag}" para ${CLI_PACKAGE}. Disponibles: ${Object.keys(tags).join(", ")}`);
  return tags[tag];
}

export type InstallKind = "npm" | "pnpm" | "yarn" | "bun" | "npx" | "source";

/**
 * How the running CLI was installed, from the real path of its entry point. Only a global
 * package-manager install can be upgraded in place; a linked checkout or an npx run cannot.
 */
export function detectInstall(entry = process.argv[1], globalRoot = npmGlobalRoot): { kind: InstallKind; command?: string[] } {
  let path: string;
  try { path = realpathSync(entry); } catch { path = entry; }
  const normalized = path.split(sep).join("/");
  const marker = `/node_modules/${CLI_PACKAGE}/`;
  if (!normalized.includes(marker)) return { kind: "source" };
  if (/\/_npx\//.test(normalized)) return { kind: "npx" };
  if (/\/pnpm\//i.test(normalized) || /\/\.pnpm\//.test(normalized)) return { kind: "pnpm", command: ["pnpm", "add", "-g"] };
  if (/\/\.bun\//.test(normalized)) return { kind: "bun", command: ["bun", "add", "-g"] };
  if (/\/yarn\/global\//i.test(normalized) || /\/\.config\/yarn\//.test(normalized)) return { kind: "yarn", command: ["yarn", "global", "add"] };
  const root = globalRoot();
  if (root && normalized.startsWith(`${root.split(sep).join("/")}/`)) return { kind: "npm", command: ["npm", "install", "-g"] };
  // Installed as a project dependency: upgrading it belongs to that project's package.json.
  return { kind: "source" };
}

function npmGlobalRoot(): string | undefined {
  const result = run("npm", ["root", "-g"], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout).trim() : undefined;
}

/**
 * spawnSync that works with npm/pnpm/yarn shims on Windows (.cmd needs a shell). Passing an args
 * array together with `shell: true` triggers Node's DEP0190 warning, which printed over the
 * confirmation prompt, so on Windows the (trusted, fixed) arguments go in one command string.
 */
function run(binary: string, args: string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  return process.platform === "win32"
    ? spawnSync([binary, ...args].join(" "), { ...options, shell: true })
    : spawnSync(binary, args, options);
}

// ------------------------------------------------------------------ daily notice

interface UpdateCache { checkedAt: string; latest: string }
const cachePath = () => join(configDirectory(), "update-check.json");

function readCache(): UpdateCache | undefined {
  try { return JSON.parse(readFileSync(cachePath(), "utf8")) as UpdateCache; } catch { return undefined; }
}
function writeCache(latest: string): void {
  try {
    mkdirSync(configDirectory(), { recursive: true });
    writeFileSync(cachePath(), `${JSON.stringify({ checkedAt: new Date().toISOString(), latest })}\n`);
  } catch { /* the notice is best effort */ }
}

export function noticeEnabled(env = process.env, interactive = Boolean(process.stderr.isTTY)): boolean {
  return interactive && !env.CI && !env.MODAI_NO_UPDATE_NOTIFIER && env.NODE_ENV !== "test";
}

/**
 * Best-effort "new version available" notice, checked at most once a day. Returns a function that
 * prints the notice (on stderr, after the command) from the cached result; a stale cache is
 * refreshed in the background for the next run without delaying this one by more than ~1.5 s.
 */
export function startUpdateNotice(current: string, now = Date.now()): () => void {
  if (!noticeEnabled()) return () => {};
  const cache = readCache();
  if (!cache || now - Date.parse(cache.checkedAt) > DAY_MS) fetchDistTag("latest", 1500).then(writeCache, () => writeCache(cache?.latest ?? current));
  return () => {
    if (cache && semver.valid(cache.latest) && semver.valid(current) && semver.gt(cache.latest, current)) {
      process.stderr.write(`\nHay una versión nueva de MODAI: ${current} → ${cache.latest}\nActualiza con: modai upgrade\n`);
    }
  };
}

// ------------------------------------------------------------------ command

export function registerUpgradeCommand(program: Command, print: Print): void {
  program.command("upgrade").alias("self-update")
    .description("Actualiza la CLI de MODAI a la última versión publicada en npm")
    .option("--check", "Solo informa si hay una versión nueva; no instala nada")
    .option("--tag <tag>", "Etiqueta de npm: latest o next (prerelease)", "latest")
    .option("--yes", "No pide confirmación")
    .action(async (options: { check?: boolean; tag: string; yes?: boolean }) => {
      const current = program.version()!;
      const latest = await fetchDistTag(options.tag);
      if (!semver.valid(latest)) throw new Error(`El registry devolvió una versión no válida: ${latest}`);
      writeCache(options.tag === "latest" ? latest : readCache()?.latest ?? latest);
      if (!semver.gt(latest, current)) { print(`MODAI ${current} ya es la última versión (${options.tag}: ${latest}).`); return; }
      if (options.check) { print(`Hay una versión nueva: ${current} → ${latest}. Actualiza con: modai upgrade${options.tag === "latest" ? "" : ` --tag ${options.tag}`}`); return; }

      const install = detectInstall();
      const spec = `${CLI_PACKAGE}@${latest}`;
      if (!install.command) {
        const hint = install.kind === "npx"
          ? `Se está ejecutando con npx: usa npx ${CLI_PACKAGE}@${options.tag} o instálala con npm install -g ${spec}`
          : `Esta CLI no es una instalación global de npm (por ejemplo, npm link desde el repositorio o una dependencia de un proyecto). Actualiza el repositorio y recompila, o instala con: npm install -g ${spec}`;
        print(`Hay una versión nueva: ${current} → ${latest}.\n${hint}`);
        return;
      }
      if (!(await confirm(`¿Actualizar MODAI ${current} → ${latest} con ${[...install.command, spec].join(" ")}?`, options.yes))) { print("Sin cambios."); return; }
      const [binary, ...args] = install.command;
      const result = run(binary, [...args, spec], { stdio: "inherit" });
      if (result.status !== 0) {
        throw new Error(`La actualización falló (código ${result.status ?? result.error?.message}). Si es un problema de permisos, revisa el prefijo global de npm o repite: ${[...install.command, spec].join(" ")}`);
      }
      print(`MODAI actualizado a ${latest}. Comprueba con: modai --version`);
    });
}
