import { type Command, Option } from "commander";
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
    .addOption(
      new Option("--delivery <mode>", "Cambia el modo de entrega del proyecto").choices([
        "local",
        "virtual",
        "materialized",
      ]),
    )
    .action(
      async (options: {
        allow?: string[];
        frozen?: boolean;
        force?: boolean;
        keepMine?: boolean;
        delivery?: "local" | "virtual" | "materialized";
      }) => {
        const { delivery } = options;
        if (delivery && options.frozen) throw new Error("--delivery cambia la configuración; ejecútalo sin --frozen");
        const { report } = await runSync(
          requireProject(),
          delivery
            ? (file) => {
                if (delivery === "local") delete file.context.delivery;
                else {
                  if (!file.context.server || !file.context.projectId)
                    throw new Error("Vincula context.server y context.projectId primero");
                  file.context.delivery = delivery;
                }
              }
            : undefined,
          options,
        );
        print(`Sincronizado.\n${summarize(report)}`);
      },
    );
}
