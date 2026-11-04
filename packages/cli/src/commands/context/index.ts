import { loadContextIndex, loadV1Project, readKnowledgeChunk, searchKnowledge } from "@modai/core";
import type { Command } from "commander";
import { requireProject } from "../../services/project.js";
import { group } from "../../terminal/help-sections.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

function registerContextSearch(context: Command, print: Print): void {
  context
    .command("search")
    .description("Busca conocimiento relevante en los paquetes instalados")
    .argument("<query>")
    .option("--package <name>", "Limita a paquetes", commaList)
    .option("--limit <n>")
    .action((query: string, options: { package?: string[]; limit?: string }) => {
      const root = loadV1Project(requireProject()).root;
      print(
        searchKnowledge(loadContextIndex(root), query, {
          packages: options.package,
          limit: options.limit ? Number(options.limit) : undefined,
        }),
      );
    });
}

function registerContextShow(context: Command, print: Print): void {
  context
    .command("show")
    .description("Muestra un fragmento de conocimiento por ID")
    .argument("<id>")
    .action((id: string) => {
      const chunk = readKnowledgeChunk(loadContextIndex(requireProject()), id);
      if (!chunk) throw new Error(`Fragmento no encontrado: ${id}`);
      print(chunk);
    });
}

export function registerContextCommands(program: Command, print: Print): void {
  const context = group(
    program,
    "context",
    "Conocimiento de los paquetes instalados, recuperado bajo demanda con su procedencia",
  );
  registerContextSearch(context, print);
  registerContextShow(context, print);
}
