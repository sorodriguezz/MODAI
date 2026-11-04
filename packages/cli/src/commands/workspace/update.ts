import { loadV1Project } from "@modai/core";
import type { Command } from "commander";
import { changedVersions } from "../../services/packages.js";
import { runSync } from "../../services/sync.js";
import type { DiscoveredProject } from "../../services/workspace.js";
import type { Print } from "../../terminal/output.js";
import { type Outcome, type RunOptions, runOnProjects, withRunOptions } from "./run-on-projects.js";

function plan(names: string[]) {
  return async (project: DiscoveredProject): Promise<Outcome> => {
    const loaded = loadV1Project(project.root);
    const targets = names.length
      ? names.filter((name) => loaded.lock.packages[name])
      : Object.keys(loaded.lock.packages);
    return targets.length
      ? { project: project.path, result: "pendiente", detail: `revisará ${targets.length} paquete(s)` }
      : { project: project.path, result: "sin cambios", detail: "no tiene esos paquetes" };
  };
}

function apply(names: string[], keepMine?: boolean) {
  return async (project: DiscoveredProject): Promise<string> => {
    const before = loadV1Project(project.root).lock.packages;
    const { report } = await runSync(project.root, undefined, { update: names.length ? names : true, keepMine });
    const changed = changedVersions(before, report).map((item) => `${item.package} ${item.from}→${item.to}`);
    return changed.length ? changed.join(", ") : "ya estaba al día";
  };
}

export function registerWorkspaceUpdate(workspace: Command, print: Print): void {
  withRunOptions(
    workspace
      .command("update")
      .argument("[packages...]", "Paquetes; por defecto todos")
      .description("Actualiza dentro de los rangos de cada modai.yaml"),
  )
    .option("--keep-mine", "Conserva tus archivos modificados y deja la versión nueva al lado (.modai-new)")
    .action(async (names: string[] = [], options: RunOptions & { keepMine?: boolean }) => {
      await runOnProjects(
        {
          describe: names.length ? `Actualizar ${names.join(", ")}` : "Actualizar todo",
          plan: plan(names),
          apply: apply(names, options.keepMine),
        },
        options,
        print,
      );
    });
}
