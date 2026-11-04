import type { Command } from "commander";
import { adapterRows } from "../../services/catalog.js";
import { currentProject, requireProject } from "../../services/project.js";
import { runSync } from "../../services/sync.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";
import { summarize } from "../../terminal/sync-summary.js";

function registerAdapterList(adapter: Command, print: Print): void {
  adapter.command("list").action(() => {
    const active = currentProject()?.file.adapters ?? [];
    print(
      adapterRows().map((item) => ({
        id: item.definition.id,
        source: item.source,
        active: active.includes(item.definition.id),
        targets: Object.keys(item.definition.targets),
        description: item.definition.description,
      })),
    );
  });
}

function registerAdapterAdd(adapter: Command, print: Print): void {
  adapter
    .command("add")
    .argument("<id>")
    .option("--allow <permissions>", "Permisos de instalación", commaList)
    .action(async (id: string, options: { allow?: string[] }) => {
      const { report } = await runSync(
        requireProject(),
        (file) => {
          if (!file.adapters.includes(id)) file.adapters.push(id);
        },
        { allow: options.allow },
      );
      print(`Adaptador ${id} activo.\n${summarize(report)}`);
    });
}

function registerAdapterRemove(adapter: Command, print: Print): void {
  adapter
    .command("remove")
    .argument("<id>")
    .action(async (id: string) => {
      const { report } = await runSync(requireProject(), (file) => {
        file.adapters = file.adapters.filter((item) => item !== id);
      });
      print(`Adaptador ${id} desactivado.\n${summarize(report)}`);
    });
}

export function registerAdapterCommands(program: Command, print: Print): void {
  const adapter = program.command("adapter").description("Adaptadores que conectan las capacidades con cada agente");
  registerAdapterList(adapter, print);
  registerAdapterAdd(adapter, print);
  registerAdapterRemove(adapter, print);
}
