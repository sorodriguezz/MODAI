import type { Command } from "commander";
import { removePackage } from "../../services/packages.js";
import { requireProject } from "../../services/project.js";
import type { Print } from "../../terminal/output.js";
import { summarize } from "../../terminal/sync-summary.js";

export function registerRemove(program: Command, print: Print): void {
  program
    .command("remove")
    .description("Retira una dependencia directa conservando los archivos que modificaste")
    .argument("<package>", "@scope/nombre")
    .action(async (name: string) => {
      const root = requireProject();
      print(`Retirado ${name}.\n${summarize(await removePackage(root, name))}`);
    });
}
