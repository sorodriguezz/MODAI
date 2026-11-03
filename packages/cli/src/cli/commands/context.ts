import type { Command } from "commander";
import { ApiClient } from "@modai/sdk";
import { loadV1Project } from "@modai/core";
import { memoryV1, searchV1 } from "../../v1/commands.js";
import { requireV1Project, tokenFor } from "../../v1/runtime.js";
import { commaList } from "../agent-commands.js";
import type { Print } from "../output.js";

/** Context Gateway from the terminal: knowledge search and project memory. */
export function registerContextCommands(program: Command, print: Print): void {
  program.command("search")
    .description("Busca conocimiento relevante de los paquetes instalados (Context Gateway)")
    .argument("<query>", "Consulta")
    .option("--package <names>", "Limita a paquetes", commaList)
    .option("--limit <n>", "Máximo de resultados")
    .action((query: string, options) => searchV1(requireV1Project(), query, options, print));

  program.command("remember")
    .description("Guarda una memoria del proyecto")
    .argument("<content>", "Contenido")
    .option("--kind <kind>", "decision, constraint, lesson, preference o note", "note")
    .option("--scope <scope>", "project o user (memoria local)", "project")
    .action((content: string, options) => memoryV1(requireV1Project(), "remember", content, options, print));

  program.command("recall").description("Recupera memorias del proyecto").argument("<query>", "Consulta")
    .action((query: string) => memoryV1(requireV1Project(), "recall", query, {}, print));
  program.command("memories").description("Lista las memorias del proyecto").action(() => memoryV1(requireV1Project(), "list", undefined, {}, print));
  program.command("forget").description("Elimina una memoria por ID").argument("<id>").action((id: string) => memoryV1(requireV1Project(), "forget", id, {}, print));

  program.command("memory-update")
    .description("Actualiza una memoria compartida del servidor por ID")
    .argument("<id>").argument("<content>")
    .option("--kind <kind>").option("--scope <scope>")
    .action(async (id: string, content: string, options: { kind?: string; scope?: string }) => {
      const { context } = loadV1Project(requireV1Project()).file;
      if (context.memory !== "remote" || !context.server) throw new Error("La memoria local no se edita: elimínala con 'modai forget' y crea otra con 'modai remember'");
      print(await new ApiClient(context.server, tokenFor(context.server)).updateMemory(id, { content, kind: options.kind, scope: options.scope }));
    });
}
