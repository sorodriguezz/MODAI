// Bulk operations over many projects under one root (a folder of repositories or a monorepo).
// Safety model: discover without following symlinks, show the plan first and ask for confirmation,
// run one project at a time with a lock, never let one failure leave a project half-changed
// (modai.yaml is only saved after its sync succeeds), and report every project at the end.
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Command } from "commander";
import { isV1Project, loadV1Project } from "@modai/core";
import { addPackages, parseSpec, removePackage } from "./commands.js";
import { featureChoice, manifestForSpec, splitPackageFlags } from "./features.js";
import { confirm, projectRegistry, runSync, summarize } from "./runtime.js";
import { commaList } from "../cli/agent-commands.js";
import { isJsonMode, printList, type Print } from "../cli/output.js";

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "target", "vendor", "coverage", ".next", ".turbo", ".venv", "venv", "__pycache__"]);
const MAX_DIRECTORIES = 20_000;
const LOCK_FILE = ".modai/.workspace.lock";
const STALE_LOCK_MS = 15 * 60 * 1000;

export interface DiscoveredProject { root: string; path: string }

/**
 * Finds MODAI projects under `root`. Symlinks are never followed (a link cannot pull the walk
 * outside the root or into a cycle), heavy folders are skipped and the walk is bounded.
 */
export function discoverProjects(root: string, options: { depth?: number; filter?: string[] } = {}): DiscoveredProject[] {
  const base = resolve(root);
  if (!statSync(base).isDirectory()) throw new Error(`No es una carpeta: ${base}`);
  const depth = options.depth ?? 4;
  const found: DiscoveredProject[] = [];
  let visited = 0;
  const walk = (directory: string, level: number) => {
    if (++visited > MAX_DIRECTORIES) throw new Error(`Hay más de ${MAX_DIRECTORIES} carpetas bajo ${base}; usa una raíz más concreta o --depth menor`);
    if (isV1Project(directory)) found.push({ root: directory, path: relative(base, directory) || "." });
    if (level >= depth) return;
    let entries: string[];
    try { entries = readdirSync(directory); } catch { return; }
    for (const name of entries.sort()) {
      if (SKIPPED_DIRECTORIES.has(name) || name === ".modai" || (name.startsWith(".") && name !== ".")) continue;
      const child = join(directory, name);
      let info;
      try { info = lstatSync(child); } catch { continue; }
      if (info.isDirectory() && !info.isSymbolicLink()) walk(child, level + 1);
    }
  };
  walk(base, 0);
  const filters = (options.filter ?? []).map(item => item.toLowerCase());
  return filters.length ? found.filter(project => filters.some(filter => project.path.toLowerCase().includes(filter))) : found;
}

/** Exclusive per-project lock so two bulk runs (or a run and a teammate's script) never interleave. */
function acquireLock(root: string): () => void {
  const path = join(root, LOCK_FILE);
  try {
    const age = Date.now() - statSync(path).mtimeMs;
    if (age < STALE_LOCK_MS) throw new Error(`otra operación de MODAI está en curso (${LOCK_FILE}); si no es así, borra ese archivo`);
    rmSync(path, { force: true });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  mkdirSync(join(root, ".modai"), { recursive: true });
  writeFileSync(path, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
  return () => { try { if (readFileSync(path, "utf8").startsWith(`${process.pid} `)) rmSync(path, { force: true }); } catch { /* already gone */ } };
}

type Outcome = { project: string; result: "hecho" | "sin cambios" | "omitido" | "error" | "pendiente"; detail: string };
type Action = { describe: string; plan: (project: DiscoveredProject) => Promise<Outcome>; apply: (project: DiscoveredProject) => Promise<string> };

interface RunOptions { root: string; depth?: string; filter?: string[]; dryRun?: boolean; yes?: boolean; failFast?: boolean }

async function runOnProjects(action: Action, options: RunOptions, print: Print): Promise<void> {
  const depth = options.depth === undefined ? 4 : Number(options.depth);
  if (!Number.isInteger(depth) || depth < 0 || depth > 10) throw new Error("--depth debe estar entre 0 y 10");
  const projects = discoverProjects(options.root, { depth, filter: options.filter });
  if (!projects.length) throw new Error(`No hay proyectos MODAI bajo ${resolve(options.root)}${options.filter?.length ? " que coincidan con el filtro" : ""}. Inicializa cada repositorio con 'modai init'.`);

  // 1. Plan: read-only checks for every project before touching any of them.
  const plan: Array<{ project: DiscoveredProject; outcome: Outcome }> = [];
  for (const project of projects) {
    try { plan.push({ project, outcome: await action.plan(project) }); }
    catch (error) { plan.push({ project, outcome: { project: project.path, result: "error", detail: (error as Error).message } }); }
  }
  const pending = plan.filter(item => item.outcome.result === "pendiente");
  if (!isJsonMode()) {
    print(`${action.describe} en ${resolve(options.root)}:`);
    printList(plan.map(item => item.outcome), "");
  }
  if (options.dryRun || !pending.length) {
    if (isJsonMode()) print(plan.map(item => item.outcome));
    if (!pending.length && !isJsonMode()) print("No hay cambios que aplicar.");
    if (plan.some(item => item.outcome.result === "error")) process.exitCode = 1;
    return;
  }
  if (!(await confirm(`¿Aplicar en ${pending.length} proyecto(s)?`, options.yes))) { print("Sin cambios."); return; }

  // 2. Apply, one project at a time. Ctrl+C finishes the current project and stops cleanly.
  let interrupted = false;
  const stop = () => { interrupted = true; process.stderr.write("\nDeteniendo después del proyecto actual…\n"); };
  process.once("SIGINT", stop);
  const results = new Map(plan.map(item => [item.project.root, item.outcome]));
  try {
    for (const { project } of pending) {
      if (interrupted) { results.set(project.root, { project: project.path, result: "omitido", detail: "interrumpido" }); continue; }
      let release: (() => void) | undefined;
      try {
        release = acquireLock(project.root);
        results.set(project.root, { project: project.path, result: "hecho", detail: await action.apply(project) });
      } catch (error) {
        results.set(project.root, { project: project.path, result: "error", detail: (error as Error).message.split("\n")[0] });
        if (options.failFast) interrupted = true;
      } finally { release?.(); }
      if (!isJsonMode()) process.stderr.write(`${results.get(project.root)!.result === "error" ? "✗" : "✓"} ${project.path}\n`);
    }
  } finally { process.removeListener("SIGINT", stop); }

  const final = [...results.values()];
  if (isJsonMode()) print(final);
  else { print("\nResultado:"); printList(final, ""); }
  const failed = final.filter(item => item.result === "error").length;
  if (failed) { process.exitCode = 1; if (!isJsonMode()) print(`${failed} proyecto(s) con error; los demás quedaron aplicados. Corrige y repite: los ya hechos aparecerán sin cambios.`); }
}

const firstLine = (text: string) => text.split("\n").find(line => line.trim()) ?? "";

export function registerWorkspaceCommands(program: Command, print: Print): void {
  const workspace = program.command("workspace").alias("ws").description("Aplica operaciones a muchos proyectos bajo una raíz (carpeta de repositorios o monorepo)");
  const common = (command: Command) => command
    .option("--root <dir>", "Carpeta raíz donde buscar proyectos", ".")
    .option("--depth <n>", "Profundidad máxima de búsqueda (0-10)", "4")
    .option("--filter <texts>", "Solo proyectos cuya ruta contenga alguno de estos textos", commaList)
    .option("--dry-run", "Muestra el plan sin cambiar nada")
    .option("--yes", "No pide confirmación")
    .option("--fail-fast", "Se detiene en el primer error");

  workspace.command("list").description("Proyectos MODAI encontrados bajo la raíz")
    .option("--root <dir>", "Carpeta raíz", ".").option("--depth <n>", "Profundidad máxima (0-10)", "4").option("--filter <texts>", "Filtro por ruta", commaList)
    .action((options: { root: string; depth: string; filter?: string[] }) => {
      const projects = discoverProjects(options.root, { depth: Number(options.depth), filter: options.filter });
      printList(projects.map(project => {
        const loaded = loadV1Project(project.root);
        return { project: project.path, name: loaded.file.name, packages: Object.keys(loaded.file.dependencies).join(", ") };
      }), `No hay proyectos MODAI bajo ${resolve(options.root)}.`);
    });

  common(workspace.command("add").argument("<packages...>", "@scope/nombre[@rango], cada uno seguido de sus flags (--tls, --no-metrics)").description("Añade paquetes en todos los proyectos encontrados, con las mismas features en todos"))
    .option("--allow <permissions>", "Permisos de instalación concedidos en cada proyecto", commaList)
    .allowUnknownOption()
    .action(async (_specs: string[], options: RunOptions & { allow?: string[] }, command: Command) => {
      // Same syntax as modai add: each feature flag belongs to the package written before it.
      const groups = splitPackageFlags(command.args);
      // file: paths are resolved once, against where the command runs, not inside each project.
      const absolute = groups.map(item => ({ ...item, spec: /^(file:|\.\.?\/|\/)/.test(item.spec) ? `file:${resolve(item.spec.replace(/^file:/, ""))}` : item.spec }));
      const specs = absolute.map(item => item.spec);
      const choices = async (root: string) => {
        const features: Record<string, Record<string, boolean>> = {};
        for (const item of absolute) if (item.flags.length) { const manifest = await manifestForSpec(item.spec, root); features[manifest.metadata.name] = featureChoice(manifest, item.flags); }
        return features;
      };
      const flagsText = absolute.filter(item => item.flags.length).map(item => `${item.spec} ${item.flags.join(" ")}`).join("; ");
      await runOnProjects({
        describe: `Añadir ${specs.join(", ")}${flagsText ? ` (${flagsText})` : ""}`,
        plan: async project => {
          const loaded = loadV1Project(project.root);
          const missing = specs.map(spec => parseSpec(spec, project.root)).filter(item => !(item.name in loaded.file.dependencies));
          if (!missing.length) return { project: project.path, result: "sin cambios", detail: "ya está instalado" };
          const registry = projectRegistry(loaded);
          for (const item of missing) if (!item.value.startsWith("file:") && !(await registry.versions(item.name)).length) throw new Error(`${item.name} no existe en sus registries`);
          await choices(project.root); // unknown or misspelled flags fail in the plan, before touching any project
          return { project: project.path, result: "pendiente", detail: `añadirá ${missing.map(item => item.name).join(", ")}` };
        },
        apply: async project => {
          const loaded = loadV1Project(project.root);
          const missing = specs.filter(spec => !(parseSpec(spec, project.root).name in loaded.file.dependencies));
          const { names, needsGrant, report } = await addPackages(project.root, missing, { allow: options.allow, features: await choices(project.root) });
          const withFeatures = names.filter(name => report.lock.packages[name]?.features.length).map(name => `${name} (${report.lock.packages[name]!.features.join(", ")})`);
          return `añadido ${names.join(", ")}${withFeatures.length ? ` · features: ${withFeatures.join("; ")}` : ""}${needsGrant.length ? ` · requiere modai permissions grant ${needsGrant.join(", ")}` : ""}`;
        },
      }, options, print);
    });

  common(workspace.command("remove").argument("<package>", "@scope/nombre").description("Retira un paquete de todos los proyectos que lo tienen"))
    .action(async (name: string, options: RunOptions) => {
      await runOnProjects({
        describe: `Retirar ${name}`,
        plan: async project => name in loadV1Project(project.root).file.dependencies
          ? { project: project.path, result: "pendiente", detail: "lo retirará (conserva archivos que modificaste)" }
          : { project: project.path, result: "sin cambios", detail: "no lo tiene" },
        apply: async project => firstLine(summarize(await removePackage(project.root, name))),
      }, options, print);
    });

  common(workspace.command("update").argument("[packages...]", "Paquetes; por defecto todos").description("Actualiza dentro de los rangos de cada modai.yaml"))
    .option("--keep-mine", "Conserva tus archivos modificados y deja la versión nueva al lado (.modai-new)")
    .action(async (names: string[] = [], options: RunOptions & { keepMine?: boolean }) => {
      await runOnProjects({
        describe: names.length ? `Actualizar ${names.join(", ")}` : "Actualizar todo",
        plan: async project => {
          const loaded = loadV1Project(project.root);
          const targets = names.length ? names.filter(name => loaded.lock.packages[name]) : Object.keys(loaded.lock.packages);
          return targets.length ? { project: project.path, result: "pendiente", detail: `revisará ${targets.length} paquete(s)` } : { project: project.path, result: "sin cambios", detail: "no tiene esos paquetes" };
        },
        apply: async project => {
          const before = loadV1Project(project.root).lock.packages;
          const { report } = await runSync(project.root, undefined, { update: names.length ? names : true, keepMine: options.keepMine });
          const changed = Object.entries(report.lock.packages).filter(([name, item]) => before[name]?.version !== item.version).map(([name, item]) => `${name} ${before[name]?.version ?? "nuevo"}→${item.version}`);
          return changed.length ? changed.join(", ") : "ya estaba al día";
        },
      }, options, print);
    });

  common(workspace.command("sync").description("Reconstruye cada proyecto desde su modai.yaml y modai.lock"))
    .option("--frozen", "Falla si un modai.lock no corresponde a su modai.yaml (CI)")
    .action(async (options: RunOptions & { frozen?: boolean }) => {
      await runOnProjects({
        describe: "Sincronizar",
        plan: async project => ({ project: project.path, result: "pendiente", detail: `${Object.keys(loadV1Project(project.root).file.dependencies).length} dependencia(s)` }),
        apply: async project => firstLine(summarize((await runSync(project.root, undefined, { frozen: options.frozen })).report)),
      }, options, print);
    });
}
