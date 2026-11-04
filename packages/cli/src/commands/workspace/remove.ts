import { loadV1Project } from "@modai/core";
import type { Command } from "commander";
import { removePackage } from "../../services/packages.js";
import type { Print } from "../../terminal/output.js";
import { firstLine, summarize } from "../../terminal/sync-summary.js";
import { type RunOptions, runOnProjects, withRunOptions } from "./run-on-projects.js";

export function registerWorkspaceRemove(workspace: Command, print: Print): void {
  withRunOptions(
    workspace
      .command("remove")
      .argument("<package>", "@scope/nombre")
      .description("Retira un paquete de todos los proyectos que lo tienen"),
  ).action(async (name: string, options: RunOptions) => {
    await runOnProjects(
      {
        describe: `Retirar ${name}`,
        plan: async (project) =>
          name in loadV1Project(project.root).file.dependencies
            ? { project: project.path, result: "pendiente", detail: "lo retirará (conserva archivos que modificaste)" }
            : { project: project.path, result: "sin cambios", detail: "no lo tiene" },
        apply: async (project) => firstLine(summarize(await removePackage(project.root, name))),
      },
      options,
      print,
    );
  });
}
