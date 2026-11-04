import { loadV1Project } from "@modai/core";
import type { Command } from "commander";
import { changedVersions } from "../../services/packages.js";
import { requireProject } from "../../services/project.js";
import { runSync } from "../../services/sync.js";
import type { Print } from "../../terminal/output.js";
import { summarize } from "../../terminal/sync-summary.js";

export function registerUpdate(program: Command, print: Print): void {
  program
    .command("update")
    .description("Actualiza dependencias dentro de los rangos de modai.yaml")
    .argument("[packages...]", "Paquetes a actualizar; por defecto todos")
    .option(
      "--keep-mine",
      "Si modificaste archivos administrados, conserva tu versión y deja la nueva al lado (.modai-new)",
    )
    .option("--force", "Sobrescribe tus cambios en archivos administrados")
    .action(async (names: string[] = [], options: { keepMine?: boolean; force?: boolean }) => {
      const root = requireProject();
      const before = loadV1Project(root).lock.packages;
      const { report } = await runSync(root, undefined, {
        update: names.length ? names : true,
        force: options.force,
        keepMine: options.keepMine,
      });
      const changed = changedVersions(before, report);
      print(changed.length ? changed : "Todo está en la última versión permitida por modai.yaml.");
      print(summarize(report));
    });
}
