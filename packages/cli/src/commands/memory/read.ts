import type { Command } from "commander";
import { projectMemory, remoteMemoryConnection } from "../../services/memory.js";
import type { Print } from "../../terminal/output.js";
import { type MemoryOptions, PROJECT_OPTION } from "./options.js";

type ReadOptions = MemoryOptions & { personal?: boolean; organization?: boolean; session?: string };

function readOptions(options: ReadOptions) {
  return {
    includePersonal: options.personal ?? !options.project,
    includeOrganization: options.organization,
    sessionId: options.session,
  };
}

function withReadOptions(command: Command) {
  return command
    .option(...PROJECT_OPTION)
    .option("--personal", "Incluye memoria personal remota")
    .option("--organization", "Incluye memoria aprobada de la organización")
    .option("--session <id>", "Incluye memoria privada de esta sesión");
}

export function registerMemorySearch(memory: Command, print: Print): void {
  withReadOptions(
    memory
      .command("search")
      .description("Recupera las memorias relevantes para una consulta")
      .argument("<query>", "Consulta"),
  ).action(async (query: string, options: ReadOptions) => {
    const remote = remoteMemoryConnection(options.project);
    print(
      remote ? await remote.api.recall(remote.id, query, readOptions(options)) : await projectMemory().recall(query),
    );
  });
}

export function registerMemoryList(memory: Command, print: Print): void {
  withReadOptions(memory.command("list").alias("ls").description("Lista las memorias del proyecto")).action(
    async (options: ReadOptions) => {
      const remote = remoteMemoryConnection(options.project);
      print(remote ? await remote.api.listMemories(remote.id, readOptions(options)) : await projectMemory().list());
    },
  );
}
