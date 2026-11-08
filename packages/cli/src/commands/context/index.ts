import { loadContextIndex, readKnowledgeChunk, searchKnowledge } from "@modai/core";
import type { Command } from "commander";
import { profileConnection, searchProfileKnowledge } from "../../services/profile.js";
import { profileSkillReader } from "../../services/profile-skill.js";
import { currentProject, requireProject } from "../../services/project.js";
import { group } from "../../terminal/help-sections.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

function registerContextSearch(context: Command, print: Print): void {
  context
    .command("search")
    .description("Busca conocimiento en el proyecto local o en su perfil efectivo")
    .argument("<query>")
    .option("--package <name>", "Limita a paquetes", commaList)
    .option("--limit <n>")
    .option("--project <id>", "Consulta el perfil central de este proyecto")
    .option("--local", "Consulta solo el índice del repositorio")
    .action(
      async (query: string, options: { package?: string[]; limit?: string; project?: string; local?: boolean }) => {
        const context = currentProject()?.file.context;
        const limit = options.limit ? Number(options.limit) : undefined;
        if (options.local && options.project) throw new Error("Elige --local o --project");
        if (!options.local && (options.project || context?.delivery === "virtual")) {
          print(
            await searchProfileKnowledge(query, {
              projectId: options.project,
              context,
              packages: options.package,
              limit,
            }),
          );
          return;
        }
        const root = requireProject();
        print(
          searchKnowledge(loadContextIndex(root), query, {
            packages: options.package,
            limit,
          }),
        );
      },
    );
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
  context
    .command("skill <package> [skill]")
    .description("Lista o lee las skills de un paquete del perfil efectivo")
    .option("--project <id>", "Proyecto del servidor")
    .action(async (packageName: string, skill: string | undefined, options: { project?: string }) => {
      const project = currentProject();
      const read = profileSkillReader(
        profileConnection(options.project, project?.file.context),
        project?.file.signaturePolicy,
      );
      print(await read(packageName, skill));
    });
}
