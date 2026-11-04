import { join } from "node:path";
import {
  configDirectory,
  FileMemoryStore,
  LocalMemoryProvider,
  loadV1Project,
  type MemoryProvider,
  type V1Project,
} from "@modai/core";
import { ApiClient } from "@modai/sdk";
import { tokenFor } from "./connection.js";
import { requireProject } from "./project.js";

class RemoteMemoryProvider implements MemoryProvider {
  constructor(
    private readonly api: ApiClient,
    private readonly projectId: string,
  ) {}
  remember(input: { content: string; kind?: string }) {
    return this.api.remember({ projectId: this.projectId, content: input.content, kind: input.kind ?? "note" });
  }
  recall(query: string) {
    return this.api.recall(this.projectId, query);
  }
  list() {
    return this.api.listMemories(this.projectId);
  }
  forget(id: string) {
    return this.api.deleteMemory(id);
  }
}

export function memoryProvider(project: V1Project): MemoryProvider | undefined {
  const context = project.file.context;
  if (context.memory === "off") return undefined;
  if (context.memory === "remote") {
    if (!context.server || !context.projectId)
      throw new Error("context.memory=remote requiere context.server y context.projectId en modai.yaml");
    return new RemoteMemoryProvider(new ApiClient(context.server, tokenFor(context.server)), context.projectId);
  }
  return new LocalMemoryProvider(
    new FileMemoryStore(join(project.root, ".modai", "memory.jsonl"), "project"),
    new FileMemoryStore(join(configDirectory(), "memory.jsonl"), "user"),
  );
}

export function projectMemory(): MemoryProvider {
  const provider = memoryProvider(loadV1Project(requireProject()));
  if (!provider) throw new Error("La memoria está desactivada (context.memory: off)");
  return provider;
}

export function parseMemoryFile(text: string, path: string): Array<{ content: string; kind?: string }> {
  const trimmed = text.trim();
  if (path.endsWith(".md"))
    return trimmed
      .split(/\r?\n/)
      .filter((line) => /^\s*[-*]\s+/.test(line))
      .map((line) => ({ content: line.replace(/^\s*[-*]\s+/, "").trim() }))
      .filter((item) => item.content);
  const items = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
  return items.map((item, index) => {
    const value = typeof item === "string" ? { content: item } : (item as { content?: unknown; kind?: unknown });
    if (typeof value.content !== "string" || !value.content.trim())
      throw new Error(`Elemento ${index + 1} sin "content"`);
    return { content: value.content, ...(typeof value.kind === "string" ? { kind: value.kind } : {}) };
  });
}
