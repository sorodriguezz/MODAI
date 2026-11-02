import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { rank } from "./context.js";

/**
 * Local memory: durable decisions, conventions and preferences as JSON lines.
 * - project scope: <project>/.modai/memory.jsonl (versionable, shared through the repository)
 * - user scope: ~/.modai/memory.jsonl (personal technical preferences across projects)
 * Remote memory on a MODAI server is an alternative provider with the same operations.
 */
export interface MemoryEntry { id: string; scope: "project" | "user"; kind: string; content: string; tags: string[]; createdAt: string; updatedAt: string }
export interface MemoryProvider {
  remember(input: { content: string; kind?: string; tags?: string[]; scope?: "project" | "user" }): Promise<MemoryEntry | unknown>;
  recall(query: string, limit?: number): Promise<unknown[]>;
  list(): Promise<unknown[]>;
  forget(id: string): Promise<void>;
}

const MAX_CONTENT = 20_000;

export class FileMemoryStore {
  constructor(readonly path: string, readonly scope: "project" | "user") {}
  list(): MemoryEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8").split("\n").filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as MemoryEntry]; } catch { return []; } });
  }
  add(input: { content: string; kind?: string; tags?: string[] }): MemoryEntry {
    const content = input.content.trim();
    if (!content || content.length > MAX_CONTENT) throw new Error(`La memoria debe tener entre 1 y ${MAX_CONTENT} caracteres`);
    if (/(api[_-]?key|secret|password|token)\s*[:=]\s*\S{8,}/i.test(content)) throw new Error("La memoria parece contener un secreto; no se guardó");
    const now = new Date().toISOString();
    const entry: MemoryEntry = { id: randomUUID(), scope: this.scope, kind: input.kind ?? "note", content, tags: input.tags ?? [], createdAt: now, updatedAt: now };
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
    return entry;
  }
  remove(id: string): boolean {
    const entries = this.list();
    const next = entries.filter(entry => entry.id !== id);
    if (next.length === entries.length) return false;
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, next.map(entry => JSON.stringify(entry)).join("\n") + (next.length ? "\n" : ""), { mode: 0o600 });
    renameSync(temporary, this.path);
    return true;
  }
}

export class LocalMemoryProvider implements MemoryProvider {
  constructor(private readonly project: FileMemoryStore, private readonly user: FileMemoryStore) {}
  async remember(input: { content: string; kind?: string; tags?: string[]; scope?: "project" | "user" }): Promise<MemoryEntry> {
    return (input.scope === "user" ? this.user : this.project).add(input);
  }
  async list(): Promise<MemoryEntry[]> { return [...this.project.list(), ...this.user.list()]; }
  async recall(query: string, limit = 8): Promise<Array<MemoryEntry & { score: number }>> {
    return rank(await this.list(), query, entry => ({ strong: `${entry.kind} ${entry.tags.join(" ")}`, body: entry.content }), limit)
      .map(({ item, score }) => ({ ...item, score: Math.round(score * 1000) / 1000 }));
  }
  async forget(id: string): Promise<void> {
    if (!this.project.remove(id) && !this.user.remove(id)) throw new Error(`Memoria no encontrada: ${id}`);
  }
}
