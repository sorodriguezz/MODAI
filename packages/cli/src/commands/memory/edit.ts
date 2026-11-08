import { loadV1Project } from "@modai/core";
import { ApiClient } from "@modai/sdk";
import type { Command } from "commander";
import { serverApi, tokenFor } from "../../services/connection.js";
import { projectMemory, remoteMemoryConnection } from "../../services/memory.js";
import { requireProject } from "../../services/project.js";
import type { Print } from "../../terminal/output.js";
import { type MemoryOptions, PROJECT_OPTION } from "./options.js";

export function registerMemoryAdd(memory: Command, print: Print): void {
  memory
    .command("add")
    .description("Guarda una memoria del proyecto")
    .argument("<content>", "Contenido")
    .option("--kind <kind>", "decision, constraint, lesson, preference o note", "note")
    .option("--scope <scope>", "project o user. El servidor también admite organization y session", "project")
    .option(...PROJECT_OPTION)
    .option("--session <id>", "Sesión de una memoria remota")
    .action(async (content: string, options: MemoryOptions & { session?: string }) => {
      const remote = remoteMemoryConnection(options.project);
      if (remote)
        return print(
          await remote.api.remember({
            projectId: remote.id,
            content,
            kind: options.kind,
            scope: options.scope,
            sessionId: options.session,
          }),
        );
      if (options.session || (options.scope !== "project" && options.scope !== "user"))
        throw new Error("La memoria local admite los ámbitos project y user");
      print(
        await projectMemory().remember({
          content,
          kind: options.kind,
          scope: options.scope === "user" ? "user" : "project",
        }),
      );
    });
}

function remoteProjectApi(): ApiClient {
  const { context } = loadV1Project(requireProject()).file;
  if (context.memory !== "remote" || !context.server)
    throw new Error(
      "La memoria local no se edita: elimínala con 'modai memory remove' y crea otra con 'modai memory add'",
    );
  return new ApiClient(context.server, tokenFor(context.server));
}

export function registerMemoryUpdate(memory: Command, print: Print): void {
  memory
    .command("update")
    .description("Actualiza una memoria compartida del servidor por ID")
    .argument("<id>")
    .argument("<content>")
    .option("--kind <kind>")
    .option("--scope <scope>")
    .option(...PROJECT_OPTION)
    .action(async (id: string, content: string, options: MemoryOptions) => {
      const api = options.project ? serverApi() : remoteProjectApi();
      print(await api.updateMemory(id, { content, kind: options.kind, scope: options.scope }));
    });
}

export function registerMemoryRemove(memory: Command, print: Print): void {
  memory
    .command("remove")
    .alias("rm")
    .description("Elimina una memoria por ID")
    .argument("<id>")
    .option(...PROJECT_OPTION)
    .action(async (id: string, options: MemoryOptions) => {
      if (options.project) await serverApi().deleteMemory(id);
      else await projectMemory().forget(id);
      print(`Memoria eliminada: ${id}`);
    });
}
