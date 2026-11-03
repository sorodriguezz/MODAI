import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import { AppError } from "@modai/contracts/errors";
import type { LockedPackageV1, McpServerContribution, ToolContribution } from "@modai/contracts/spec-v1";
import type { PackageGrant } from "./project.js";

/** Environment forwarded to every tool. Secrets are only forwarded when declared and granted. */
const BASE_ENV = ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "TERM", "SHELL", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "COMSPEC", "PATHEXT"];

/** Permissions consumed at install time (`--allow`); they never authorise running anything. */
export const INSTALL_PERMISSIONS: readonly string[] = ["project.instructions", "project.files", "project.source"];

export interface Authorization { allowed: boolean; missing: string[]; reason?: string }

/**
 * Installing a package never authorises it. Executable contributions run only when this machine
 * granted every permission the package declares, for this exact content (integrity).
 */
export function authorize(locked: LockedPackageV1 | undefined, grant: PackageGrant | undefined): Authorization {
  if (!locked) return { allowed: false, missing: [], reason: "Paquete no instalado" };
  const required = locked.permissions.filter(permission => !INSTALL_PERMISSIONS.includes(permission));
  if (!grant) return { allowed: false, missing: required, reason: "No autorizado en este equipo; revisa sus permisos y ejecuta modai permissions grant <paquete>" };
  if (grant.integrity !== locked.integrity) return { allowed: false, missing: required, reason: "El contenido del paquete cambió desde la autorización; revisa y vuelve a ejecutar modai permissions grant" };
  const missing = required.filter(permission => !grant.permissions.includes(permission));
  return { allowed: missing.length === 0, missing, reason: missing.length ? `Faltan permisos: ${missing.join(", ")}` : undefined };
}

export function resolveCommand(command: string, args: string[], packageDir: string, projectDir: string): { command: string; args: string[] } {
  const substitute = (value: string) => value.replaceAll("${packageDir}", packageDir).replaceAll("${projectDir}", projectDir);
  const insidePackage = (path: string) => {
    const relation = relative(packageDir, path);
    if (relation.startsWith("..") || isAbsolute(relation)) throw new AppError(400, "UNSAFE_COMMAND", `La ruta sale del paquete: ${path}`);
    return path;
  };
  let resolved = command === "node" ? process.execPath : substitute(command);
  if (command.startsWith("./") || command.startsWith("${packageDir}")) resolved = insidePackage(resolve(packageDir, resolved.replace(/^\.\//, "")));
  return { command: resolved, args: args.map(arg => { const value = substitute(arg); if (arg.startsWith("${packageDir}")) insidePackage(resolve(value)); return value; }) };
}

export function toolEnvironment(envKeys: string[], grant: PackageGrant | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of BASE_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
  for (const key of envKeys) {
    if (!grant?.permissions.includes("env.read")) throw new AppError(403, "PERMISSION_REQUIRED", `La variable ${key} requiere conceder env.read`);
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const validators = new WeakMap<object, ValidateFunction>();

export interface ToolRunOptions { packageDir: string; projectDir: string; grant: PackageGrant | undefined; signal?: AbortSignal; maxOutputBytes?: number }

/** Runs a package tool: JSON input on stdin, JSON (or text) on stdout. No shell, bounded time and output. */
export async function runTool(tool: ToolContribution, input: unknown, options: ToolRunOptions): Promise<unknown> {
  let validate = validators.get(tool.inputSchema);
  if (!validate) { validate = ajv.compile(tool.inputSchema); validators.set(tool.inputSchema, validate); }
  if (JSON.stringify(input ?? {}).length > 64_000 || !validate(input ?? {})) throw new AppError(400, "INVALID_TOOL_INPUT", `Entrada inválida para ${tool.name}: ${ajv.errorsText(validate.errors)}`);
  const { command, args } = resolveCommand(tool.command, tool.args, options.packageDir, options.projectDir);
  const env = { ...toolEnvironment(tool.envKeys, options.grant), MODAI_PROJECT_DIR: options.projectDir, MODAI_PACKAGE_DIR: options.packageDir, MODAI_TOOL: tool.name };
  const limit = options.maxOutputBytes ?? 1_000_000;
  const stdout = await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.projectDir, env, shell: false, stdio: ["pipe", "pipe", "pipe"], signal: options.signal, windowsHide: true });
    let out = "", err = "", bytes = 0, settled = false;
    const finish = (error?: Error, value?: string) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolvePromise(value!); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new AppError(504, "TOOL_TIMEOUT", `${tool.name} excedió ${tool.timeoutMs} ms`)); }, tool.timeoutMs);
    const collect = (chunk: Buffer, isError: boolean) => {
      bytes += chunk.length;
      if (bytes > limit) { child.kill("SIGKILL"); finish(new AppError(413, "TOOL_OUTPUT_LIMIT", `${tool.name} excedió el límite de salida`)); return; }
      if (isError) err += chunk.toString(); else out += chunk.toString();
    };
    child.stdout.on("data", chunk => collect(chunk, false));
    child.stderr.on("data", chunk => collect(chunk, true));
    child.on("error", error => finish(error));
    child.on("close", code => code === 0 ? finish(undefined, out) : finish(new AppError(500, "TOOL_FAILED", `${tool.name} terminó con código ${code}: ${(err || out).slice(0, 2000)}`)));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input ?? {}));
  });
  const trimmed = stdout.trim();
  try { return trimmed ? JSON.parse(trimmed) : null; } catch { return trimmed; }
}

export function mcpServerLaunch(server: McpServerContribution, options: { packageDir: string; projectDir: string; grant: PackageGrant | undefined }) {
  const { command, args } = resolveCommand(server.command, server.args, options.packageDir, options.projectDir);
  return { command, args, env: toolEnvironment(server.envKeys, options.grant) as Record<string, string>, cwd: options.projectDir };
}

