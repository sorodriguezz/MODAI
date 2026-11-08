import type { Command } from "commander";
import type { Print } from "../../terminal/output.js";
import { registerMemoryAdd, registerMemoryRemove, registerMemoryUpdate } from "./edit.js";
import { registerMemoryList, registerMemorySearch } from "./read.js";
import { registerMemoryReview } from "./review.js";
import { registerMemoryExport, registerMemoryImport } from "./transfer.js";

export function registerMemoryCommands(program: Command, print: Print): void {
  const memory = program
    .command("memory")
    .description("Memoria del proyecto: decisiones, restricciones y lecciones que guardan los agentes");
  registerMemoryAdd(memory, print);
  registerMemorySearch(memory, print);
  registerMemoryList(memory, print);
  registerMemoryUpdate(memory, print);
  registerMemoryRemove(memory, print);
  registerMemoryImport(memory, print);
  registerMemoryExport(memory, print);
  registerMemoryReview(memory, print);
}
