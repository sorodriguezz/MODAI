import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { parseMemoryFile, projectMemory } from "../../services/memory.js";
import type { Print } from "../../terminal/output.js";
import { type MemoryOptions, PROJECT_OPTION } from "./options.js";

export function registerMemoryImport(memory: Command, print: Print): void {
  memory
    .command("import")
    .description("Sube memorias desde un archivo: JSON (lista), JSONL o Markdown (cada viñeta es una memoria)")
    .argument("<file>")
    .option("--kind <kind>", "Tipo para las que no lo indiquen", "note")
    .option(...PROJECT_OPTION)
    .action(async (file: string, options: MemoryOptions) => {
      const items = parseMemoryFile(readFileSync(resolve(file), "utf8"), file.toLowerCase());
      if (options.project)
        for (const item of items)
          await serverApi().remember({
            projectId: options.project,
            content: item.content,
            kind: item.kind ?? options.kind,
          });
      else {
        const provider = projectMemory();
        for (const item of items)
          await provider.remember({ content: item.content, kind: item.kind ?? options.kind, scope: "project" });
      }
      print(`Importadas ${items.length} memorias.`);
    });
}

export function registerMemoryExport(memory: Command, print: Print): void {
  memory
    .command("export")
    .description("Descarga las memorias del proyecto como JSONL")
    .argument("[file]", "Archivo destino (por defecto, la salida estándar)")
    .option(...PROJECT_OPTION)
    .action(async (file: string | undefined, options: MemoryOptions) => {
      const memories: unknown[] = options.project
        ? await serverApi().listMemories(options.project)
        : ((await projectMemory().list()) as unknown[]);
      const text = memories.map((item) => JSON.stringify(item)).join("\n") + (memories.length ? "\n" : "");
      if (!file) {
        process.stdout.write(text);
        return;
      }
      writeFileSync(resolve(file), text, "utf8");
      print(`Exportadas ${memories.length} memorias en ${resolve(file)}`);
    });
}
