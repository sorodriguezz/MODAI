import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { ApiClient } from "@modai/sdk";
import { loadV1Project } from "@modai/core";
import { memoryV1 } from "../../v1/commands.js";
import { memoryProvider, requireV1Project, tokenFor } from "../../v1/runtime.js";
import { effectiveConnection } from "../connection.js";
import type { Print } from "../output.js";

type MemoryOptions = { project?: string; kind?: string; scope?: string };
const serverApi = () => { const connection = effectiveConnection(); return new ApiClient(connection.server, connection.token); };
const projectOption = ["--project <id>", "Proyecto del servidor (sin modai.yaml); por defecto, el del proyecto actual"] as const;

/** Reads memories from JSON (array), JSONL or Markdown (each "- " item is one memory). */
export function parseMemoryFile(text: string, path: string): Array<{ content: string; kind?: string }> {
  const trimmed = text.trim();
  if (path.endsWith(".md")) return trimmed.split(/\r?\n/).filter(line => /^\s*[-*]\s+/.test(line)).map(line => ({ content: line.replace(/^\s*[-*]\s+/, "").trim() })).filter(item => item.content);
  const items = trimmed.startsWith("[") ? JSON.parse(trimmed) as unknown[] : trimmed.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as unknown);
  return items.map((item, index) => {
    const value = typeof item === "string" ? { content: item } : item as { content?: unknown; kind?: unknown };
    if (typeof value.content !== "string" || !value.content.trim()) throw new Error(`Elemento ${index + 1} sin "content"`);
    return { content: value.content, ...(typeof value.kind === "string" ? { kind: value.kind } : {}) };
  });
}

/** Project memory: decisions, constraints and lessons the agents keep (local or on the server). */
export function registerContextCommands(program: Command, print: Print): void {
  const memory = program.command("memory").description("Memoria del proyecto: decisiones, restricciones y lecciones que guardan los agentes");
  memory.command("add")
    .description("Guarda una memoria del proyecto")
    .argument("<content>", "Contenido")
    .option("--kind <kind>", "decision, constraint, lesson, preference o note", "note")
    .option("--scope <scope>", "project o user (memoria local); project, organization o session en el servidor", "project")
    .option(...projectOption)
    .action(async (content: string, options: MemoryOptions) => {
      if (options.project) return print(await serverApi().remember({ projectId: options.project, content, kind: options.kind, scope: options.scope as "project" }));
      return memoryV1(requireV1Project(), "remember", content, options, print);
    });
  memory.command("search").description("Recupera las memorias relevantes para una consulta").argument("<query>", "Consulta").option(...projectOption)
    .action(async (query: string, options: MemoryOptions) => options.project ? print(await serverApi().recall(options.project, query)) : memoryV1(requireV1Project(), "recall", query, {}, print));
  memory.command("list").alias("ls").description("Lista las memorias del proyecto").option(...projectOption)
    .action(async (options: MemoryOptions) => options.project ? print(await serverApi().listMemories(options.project)) : memoryV1(requireV1Project(), "list", undefined, {}, print));
  memory.command("update")
    .description("Actualiza una memoria compartida del servidor por ID")
    .argument("<id>").argument("<content>")
    .option("--kind <kind>").option("--scope <scope>").option(...projectOption)
    .action(async (id: string, content: string, options: MemoryOptions) => {
      if (options.project) return print(await serverApi().updateMemory(id, { content, kind: options.kind, scope: options.scope }));
      const { context } = loadV1Project(requireV1Project()).file;
      if (context.memory !== "remote" || !context.server) throw new Error("La memoria local no se edita: elimínala con 'modai memory remove' y crea otra con 'modai memory add'");
      print(await new ApiClient(context.server, tokenFor(context.server)).updateMemory(id, { content, kind: options.kind, scope: options.scope }));
    });
  memory.command("remove").alias("rm").description("Elimina una memoria por ID").argument("<id>").option(...projectOption)
    .action(async (id: string, options: MemoryOptions) => {
      if (!options.project) return memoryV1(requireV1Project(), "forget", id, {}, print);
      await serverApi().deleteMemory(id);
      print(`Memoria eliminada: ${id}`);
    });
  memory.command("import").description("Sube memorias desde un archivo: JSON (lista), JSONL o Markdown (cada viñeta es una memoria)")
    .argument("<file>").option("--kind <kind>", "Tipo para las que no lo indiquen", "note").option(...projectOption)
    .action(async (file: string, options: MemoryOptions) => {
      const items = parseMemoryFile(readFileSync(resolve(file), "utf8"), file.toLowerCase());
      if (options.project) for (const item of items) await serverApi().remember({ projectId: options.project, content: item.content, kind: item.kind ?? options.kind });
      else {
        const provider = memoryProvider(loadV1Project(requireV1Project()));
        if (!provider) throw new Error("La memoria está desactivada (context.memory: off)");
        for (const item of items) await provider.remember({ content: item.content, kind: item.kind ?? options.kind, scope: "project" });
      }
      print(`Importadas ${items.length} memorias.`);
    });
  memory.command("export").description("Descarga las memorias del proyecto como JSONL").argument("[file]", "Archivo destino (por defecto, la salida estándar)").option(...projectOption)
    .action(async (file: string | undefined, options: MemoryOptions) => {
      let memories: unknown[];
      if (options.project) memories = await serverApi().listMemories(options.project);
      else {
        const provider = memoryProvider(loadV1Project(requireV1Project()));
        if (!provider) throw new Error("La memoria está desactivada (context.memory: off)");
        memories = await provider.list() as unknown[];
      }
      const text = memories.map(item => JSON.stringify(item)).join("\n") + (memories.length ? "\n" : "");
      if (!file) { process.stdout.write(text); return; }
      writeFileSync(resolve(file), text, "utf8");
      print(`Exportadas ${memories.length} memorias en ${resolve(file)}`);
    });
}
