import type { Command } from "commander";
import { ApiClient } from "@modai/sdk";
import { loadV1Project } from "@modai/core";
import { memoryV1 } from "../../v1/commands.js";
import { requireV1Project, tokenFor } from "../../v1/runtime.js";
import type { Print } from "../output.js";

/** Project memory: decisions, constraints and lessons the agents keep (local or on the server). */
export function registerContextCommands(program: Command, print: Print): void {
  const memory = program.command("memory").description("Memoria del proyecto: decisiones, restricciones y lecciones que guardan los agentes");
  memory.command("add")
    .description("Guarda una memoria del proyecto")
    .argument("<content>", "Contenido")
    .option("--kind <kind>", "decision, constraint, lesson, preference o note", "note")
    .option("--scope <scope>", "project o user (memoria local)", "project")
    .action((content: string, options) => memoryV1(requireV1Project(), "remember", content, options, print));
  memory.command("search").description("Recupera las memorias relevantes para una consulta").argument("<query>", "Consulta")
    .action((query: string) => memoryV1(requireV1Project(), "recall", query, {}, print));
  memory.command("list").alias("ls").description("Lista las memorias del proyecto").action(() => memoryV1(requireV1Project(), "list", undefined, {}, print));
  memory.command("update")
    .description("Actualiza una memoria compartida del servidor por ID")
    .argument("<id>").argument("<content>")
    .option("--kind <kind>").option("--scope <scope>")
    .action(async (id: string, content: string, options: { kind?: string; scope?: string }) => {
      const { context } = loadV1Project(requireV1Project()).file;
      if (context.memory !== "remote" || !context.server) throw new Error("La memoria local no se edita: elimínala con 'modai memory remove' y crea otra con 'modai memory add'");
      print(await new ApiClient(context.server, tokenFor(context.server)).updateMemory(id, { content, kind: options.kind, scope: options.scope }));
    });
  memory.command("remove").alias("rm").description("Elimina una memoria por ID").argument("<id>").action((id: string) => memoryV1(requireV1Project(), "forget", id, {}, print));
}
