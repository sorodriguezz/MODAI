import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { projectMemory } from "../../services/memory.js";
import type { Print } from "../../terminal/output.js";
import { type MemoryOptions, PROJECT_OPTION } from "./options.js";

export function registerMemorySearch(memory: Command, print: Print): void {
  memory
    .command("search")
    .description("Recupera las memorias relevantes para una consulta")
    .argument("<query>", "Consulta")
    .option(...PROJECT_OPTION)
    .action(async (query: string, options: MemoryOptions) =>
      print(options.project ? await serverApi().recall(options.project, query) : await projectMemory().recall(query)),
    );
}

export function registerMemoryList(memory: Command, print: Print): void {
  memory
    .command("list")
    .alias("ls")
    .description("Lista las memorias del proyecto")
    .option(...PROJECT_OPTION)
    .action(async (options: MemoryOptions) =>
      print(options.project ? await serverApi().listMemories(options.project) : await projectMemory().list()),
    );
}
