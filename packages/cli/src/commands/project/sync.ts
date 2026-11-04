import type { Command } from "commander";
import { requireProject } from "../../services/project.js";
import { runSync } from "../../services/sync.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";
import { summarize } from "../../terminal/sync-summary.js";

export function registerSync(program: Command, print: Print): void {
  program
    .command("sync")
    .description("Reconstruye el entorno exacto desde modai.yaml y modai.lock")
    .option("--allow <permissions>", "Permisos de instalación aprobados en este equipo", commaList)
    .option("--frozen", "Falla si modai.lock no corresponde a modai.yaml (CI)")
    .option("--force", "Sobrescribe archivos administrados que fueron modificados")
    .option("--keep-mine", "Conserva tus archivos modificados y deja la versión nueva al lado (.modai-new)")
    .action(async (options: { allow?: string[]; frozen?: boolean; force?: boolean; keepMine?: boolean }) => {
      const { report } = await runSync(requireProject(), undefined, options);
      print(`Sincronizado.\n${summarize(report)}`);
    });
}
