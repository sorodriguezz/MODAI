import type { Command } from "commander";
import { requireProject } from "../../services/project.js";
import { registrySource } from "../../services/registries.js";
import { runSync } from "../../services/sync.js";
import type { Print } from "../../terminal/output.js";
import { summarize } from "../../terminal/sync-summary.js";
import { listInstalled } from "../project/list.js";

function registerRegistryAdd(registry: Command, print: Print): void {
  registry
    .command("add")
    .argument("<name>")
    .argument("<url-or-path>")
    .description("Añade un registry (URL de servidor MODAI o carpeta local)")
    .action(async (name: string, value: string) => {
      const root = requireProject();
      const { report } = await runSync(root, (file) => {
        if (file.registries.some((item) => item.name === name)) throw new Error(`Ya existe el registry ${name}`);
        file.registries.push(registrySource(name, value, root));
      });
      print(`Registry ${name} añadido.\n${summarize(report)}`);
    });
}

function registerRegistryRemove(registry: Command, print: Print): void {
  registry
    .command("remove")
    .argument("<name>")
    .action(async (name: string) => {
      const { report } = await runSync(requireProject(), (file) => {
        file.registries = file.registries.filter((item) => item.name !== name);
      });
      print(`Registry ${name} retirado.\n${summarize(report)}`);
    });
}

export function registerRegistryCommands(program: Command, print: Print): void {
  const registry = program.command("registry").description("Registries del proyecto y búsqueda de paquetes");
  registry
    .command("list")
    .description("Registries configurados en modai.yaml")
    .action(() => listInstalled("registries", {}));
  registerRegistryAdd(registry, print);
  registerRegistryRemove(registry, print);
  registry
    .command("packages")
    .description("Paquetes publicados (equivale a modai list --available)")
    .option("--query <text>", "Filtro de texto")
    .option("--registry <url|path>", "Registry concreto")
    .action((options: { query?: string; registry?: string }) =>
      listInstalled("packages", { ...options, available: true }),
    );
}
