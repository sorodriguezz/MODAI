import { resolve } from "node:path";
import type { Command } from "commander";
import { acquireLock, type DiscoveredProject, discoverProjects } from "../../services/workspace.js";
import { commaList } from "../../terminal/options.js";
import { isJsonMode, type Print, printList } from "../../terminal/output.js";
import { confirmAction } from "../../terminal/prompts.js";

export type Outcome = {
  project: string;
  result: "hecho" | "sin cambios" | "omitido" | "error" | "pendiente";
  detail: string;
};
export type Action = {
  describe: string;
  plan: (project: DiscoveredProject) => Promise<Outcome>;
  apply: (project: DiscoveredProject) => Promise<string>;
};
export interface RunOptions {
  root: string;
  depth?: string;
  filter?: string[];
  dryRun?: boolean;
  yes?: boolean;
  failFast?: boolean;
}
type Planned = { project: DiscoveredProject; outcome: Outcome };

export const withRunOptions = (command: Command) =>
  command
    .option("--root <dir>", "Carpeta raíz donde buscar proyectos", ".")
    .option("--depth <n>", "Profundidad máxima de búsqueda (0-10)", "4")
    .option("--filter <texts>", "Solo proyectos cuya ruta contenga alguno de estos textos", commaList)
    .option("--dry-run", "Muestra el plan sin cambiar nada")
    .option("--yes", "No pide confirmación")
    .option("--fail-fast", "Se detiene en el primer error");

function findProjects(options: RunOptions): DiscoveredProject[] {
  const depth = options.depth === undefined ? 4 : Number(options.depth);
  if (!Number.isInteger(depth) || depth < 0 || depth > 10) throw new Error("--depth debe estar entre 0 y 10");
  const projects = discoverProjects(options.root, { depth, filter: options.filter });
  if (!projects.length)
    throw new Error(
      `No hay proyectos MODAI bajo ${resolve(options.root)}${options.filter?.length ? " que coincidan con el filtro" : ""}. Inicializa cada repositorio con 'modai init'.`,
    );
  return projects;
}

async function planAll(action: Action, projects: DiscoveredProject[]): Promise<Planned[]> {
  const plan: Planned[] = [];
  for (const project of projects) {
    try {
      plan.push({ project, outcome: await action.plan(project) });
    } catch (error) {
      plan.push({ project, outcome: { project: project.path, result: "error", detail: (error as Error).message } });
    }
  }
  return plan;
}

async function applyOne(action: Action, project: DiscoveredProject): Promise<Outcome> {
  let release: (() => void) | undefined;
  try {
    release = acquireLock(project.root);
    return { project: project.path, result: "hecho", detail: await action.apply(project) };
  } catch (error) {
    return { project: project.path, result: "error", detail: (error as Error).message.split("\n")[0] };
  } finally {
    release?.();
  }
}

async function applyAll(action: Action, plan: Planned[], pending: Planned[], failFast?: boolean) {
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    process.stderr.write("\nDeteniendo después del proyecto actual…\n");
  };
  process.once("SIGINT", stop);
  const results = new Map(plan.map((item) => [item.project.root, item.outcome]));
  try {
    for (const { project } of pending) {
      if (interrupted) {
        results.set(project.root, { project: project.path, result: "omitido", detail: "interrumpido" });
        continue;
      }
      const outcome = await applyOne(action, project);
      results.set(project.root, outcome);
      if (outcome.result === "error" && failFast) interrupted = true;
      if (!isJsonMode()) process.stderr.write(`${outcome.result === "error" ? "✗" : "✓"} ${project.path}\n`);
    }
  } finally {
    process.removeListener("SIGINT", stop);
  }
  return [...results.values()];
}

function report(final: Outcome[], print: Print): void {
  if (isJsonMode()) print(final);
  else {
    print("\nResultado:");
    printList(final, "");
  }
  const failed = final.filter((item) => item.result === "error").length;
  if (!failed) return;
  process.exitCode = 1;
  if (!isJsonMode())
    print(
      `${failed} proyecto(s) con error; los demás quedaron aplicados. Corrige y repite: los ya hechos aparecerán sin cambios.`,
    );
}

export async function runOnProjects(action: Action, options: RunOptions, print: Print): Promise<void> {
  const plan = await planAll(action, findProjects(options));
  const pending = plan.filter((item) => item.outcome.result === "pendiente");
  if (!isJsonMode()) {
    print(`${action.describe} en ${resolve(options.root)}:`);
    printList(
      plan.map((item) => item.outcome),
      "",
    );
  }
  if (options.dryRun || !pending.length) {
    if (isJsonMode()) print(plan.map((item) => item.outcome));
    if (!pending.length && !isJsonMode()) print("No hay cambios que aplicar.");
    if (plan.some((item) => item.outcome.result === "error")) process.exitCode = 1;
    return;
  }
  if (!(await confirmAction(`¿Aplicar en ${pending.length} proyecto(s)?`, options.yes))) {
    print("Sin cambios.");
    return;
  }
  report(await applyAll(action, plan, pending, options.failFast), print);
}
