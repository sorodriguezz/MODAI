import type { Command } from "commander";
import { profileConnection } from "../../services/profile.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

export function registerExecutionPolicy(project: Command, print: Print): void {
  const policy = project.command("execution-policy").description("Modelos y capacidades autorizados para un proyecto");
  policy
    .command("show [id]")
    .description("Muestra la política del proyecto")
    .action(async (id?: string) => {
      const connection = profileConnection(id);
      print({ policy: await connection.api.executionPolicy(connection.id) });
    });
  policy
    .command("set <id>")
    .description("Reemplaza la política del proyecto")
    .option("--models <names>", "Modelos locales permitidos, separados por coma", commaList)
    .option("--capabilities <names>", "Herramientas permitidas, separadas por coma", commaList)
    .option("--deny-capabilities", "Impide todas las herramientas")
    .action(async (id: string, options: { models?: string[]; capabilities?: string[]; denyCapabilities?: boolean }) => {
      if (options.denyCapabilities && options.capabilities)
        throw new Error("Elige --capabilities o --deny-capabilities");
      if (!options.models && !options.capabilities && !options.denyCapabilities)
        throw new Error("Indica al menos un límite");
      const capabilities = options.denyCapabilities ? [] : options.capabilities;
      print(
        await profileConnection(id).api.setExecutionPolicy(id, {
          allowedModels: options.models,
          allowedCapabilities: capabilities,
        }),
      );
    });
  policy
    .command("clear <id>")
    .description("Retira la política del proyecto")
    .action(async (id: string) => {
      await profileConnection(id).api.deleteExecutionPolicy(id);
      print(`Política retirada de ${id}`);
    });
}
