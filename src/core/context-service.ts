import { randomUUID } from "node:crypto";
import { Database } from "./database.js";
import { AppError, invariant } from "./errors.js";
import type { MemoryInput } from "./types.js";

function ftsQuery(input: string): string {
  const terms = input.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(terms)].slice(0, 12).map((term) => `"${term.replaceAll('"', '""')}"*`).join(" OR ");
}

export class ContextService {
  constructor(private readonly db: Database) {}

  addKnowledge(input: { title: string; content: string; tags?: string[]; packageName?: string }): Record<string, unknown> {
    invariant(input?.title?.trim() && input?.content?.trim(), 400, "INVALID_KNOWLEDGE", "title y content son obligatorios");
    const id = randomUUID();
    const now = new Date().toISOString();
    const tags = input.tags ?? [];
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      this.db.connection
        .prepare(`INSERT INTO knowledge_documents
          (id, package_name, package_version, title, content, tags_json, created_at, updated_at)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`)
        .run(id, input.packageName ?? null, input.title.trim(), input.content, JSON.stringify(tags), now, now);
      this.db.connection
        .prepare("INSERT INTO knowledge_fts (id, package_name, title, content, tags) VALUES (?, ?, ?, ?, ?)")
        .run(id, input.packageName ?? null, input.title.trim(), input.content, tags.join(" "));
      this.db.connection.exec("COMMIT");
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
    return { id, ...input, tags, createdAt: now };
  }

  listKnowledge(limit = 100, offset = 0): unknown[] {
    return (this.db.connection.prepare(`SELECT id, package_name AS packageName,
      package_version AS packageVersion, title, content, tags_json AS tagsJson,
      created_at AS createdAt, updated_at AS updatedAt
      FROM knowledge_documents ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`).all(Math.min(Math.max(Math.floor(limit), 1), 500), Math.max(Math.floor(offset), 0)) as Array<Record<string, unknown>>)
      .map((item) => ({ ...item, tags: JSON.parse(item.tagsJson as string), tagsJson: undefined }));
  }

  updateKnowledge(id: string, input: { title?: string; content?: string; tags?: string[] }): unknown {
    const existing = this.db.connection.prepare("SELECT * FROM knowledge_documents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!existing) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", `Documento no encontrado: ${id}`);
    invariant(!existing.package_version, 409, "PACKAGE_KNOWLEDGE_IMMUTABLE", "El conocimiento publicado por un paquete cambia creando una nueva versión del paquete");
    const title = input.title?.trim() || existing.title as string;
    const content = input.content?.trim() || existing.content as string;
    const tags = input.tags ?? JSON.parse(existing.tags_json as string) as string[];
    const now = new Date().toISOString();
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      this.db.connection.prepare(`UPDATE knowledge_documents SET title = ?, content = ?, tags_json = ?, updated_at = ? WHERE id = ?`)
        .run(title, content, JSON.stringify(tags), now, id);
      this.db.connection.prepare("DELETE FROM knowledge_fts WHERE id = ?").run(id);
      this.db.connection.prepare("INSERT INTO knowledge_fts (id, package_name, title, content, tags) VALUES (?, ?, ?, ?, ?)")
        .run(id, existing.package_name ?? null, title, content, tags.join(" "));
      this.db.connection.prepare("DELETE FROM knowledge_vectors WHERE document_id = ?").run(id);
      this.db.connection.exec("COMMIT");
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
    return { id, title, content, tags, updatedAt: now };
  }

  deleteKnowledge(id: string): void {
    const existing = this.db.connection.prepare("SELECT package_version FROM knowledge_documents WHERE id = ?").get(id) as { package_version: string | null } | undefined;
    if (!existing) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", `Documento no encontrado: ${id}`);
    invariant(!existing.package_version, 409, "PACKAGE_KNOWLEDGE_IMMUTABLE", "Retira o elimina la versión del paquete propietario");
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      this.db.connection.prepare("DELETE FROM knowledge_fts WHERE id = ?").run(id);
      this.db.connection.prepare("DELETE FROM knowledge_documents WHERE id = ?").run(id);
      this.db.connection.exec("COMMIT");
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  searchKnowledge(input: { query: string; limit?: number; packageNames?: string[] }): unknown[] {
    invariant(typeof input?.query === "string" && input.query.trim(), 400, "INVALID_QUERY", "query es obligatorio");
    const query = ftsQuery(input.query);
    invariant(query, 400, "INVALID_QUERY", "query no contiene términos buscables");
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
    const packages = input.packageNames?.filter(Boolean) ?? [];
    const filter = packages.length ? `AND k.package_name IN (${packages.map(() => "?").join(",")})` : "";
    return this.db.connection
      .prepare(`
        SELECT k.id, k.package_name AS packageName, k.package_version AS packageVersion,
               k.title, k.content, k.tags_json AS tagsJson, k.created_at AS createdAt,
               bm25(knowledge_fts, 0, 0, 4, 1, 0.5) AS rank
        FROM knowledge_fts
        JOIN knowledge_documents k ON k.id = knowledge_fts.id
        WHERE knowledge_fts MATCH ? ${filter}
        ORDER BY rank LIMIT ?
      `)
      .all(query, ...packages, limit)
      .map((row) => {
        const item = row as Record<string, unknown>;
        return { ...item, tags: JSON.parse(item.tagsJson as string), tagsJson: undefined };
      });
  }

  remember(input: MemoryInput): Record<string, unknown> {
    invariant(input?.projectId?.trim() && input?.content?.trim(), 400, "INVALID_MEMORY", "projectId y content son obligatorios");
    const id = randomUUID();
    const now = new Date().toISOString();
    const scope = input.scope?.trim() || "project";
    const kind = input.kind?.trim() || "note";
    const metadata = input.metadata ?? {};
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      this.db.connection
        .prepare(`INSERT INTO memories
          (id, project_id, scope, kind, content, metadata_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.projectId, scope, kind, input.content, JSON.stringify(metadata), now, now);
      this.db.connection
        .prepare("INSERT INTO memories_fts (id, project_id, scope, kind, content) VALUES (?, ?, ?, ?, ?)")
        .run(id, input.projectId, scope, kind, input.content);
      this.db.connection.exec("COMMIT");
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
    return { id, projectId: input.projectId, scope, kind, content: input.content, metadata, createdAt: now, updatedAt: now };
  }

  listMemories(projectId: string, limit = 50): unknown[] {
    invariant(projectId?.trim(), 400, "INVALID_PROJECT", "projectId es obligatorio");
    return this.db.connection
      .prepare(`SELECT id, project_id AS projectId, scope, kind, content,
        metadata_json AS metadataJson, created_at AS createdAt, updated_at AS updatedAt
        FROM memories WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?`)
      .all(projectId, Math.min(Math.max(limit, 1), 200))
      .map((row) => {
        const item = row as Record<string, unknown>;
        return { ...item, metadata: JSON.parse(item.metadataJson as string), metadataJson: undefined };
      });
  }

  searchMemories(input: { projectId: string; query: string; limit?: number }): unknown[] {
    invariant(input?.projectId?.trim() && input?.query?.trim(), 400, "INVALID_QUERY", "projectId y query son obligatorios");
    const query = ftsQuery(input.query);
    invariant(query, 400, "INVALID_QUERY", "query no contiene términos buscables");
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
    return this.db.connection
      .prepare(`
        SELECT m.id, m.project_id AS projectId, m.scope, m.kind, m.content,
               m.metadata_json AS metadataJson, m.created_at AS createdAt,
               m.updated_at AS updatedAt, bm25(memories_fts, 0, 0, 0, 1, 2) AS rank
        FROM memories_fts JOIN memories m ON m.id = memories_fts.id
        WHERE memories_fts MATCH ? AND m.project_id = ?
        ORDER BY rank LIMIT ?
      `)
      .all(query, input.projectId, limit)
      .map((row) => {
        const item = row as Record<string, unknown>;
        return { ...item, metadata: JSON.parse(item.metadataJson as string), metadataJson: undefined };
      });
  }

  deleteMemory(id: string): void {
    const exists = this.db.connection.prepare("SELECT 1 FROM memories WHERE id = ?").get(id);
    if (!exists) throw new AppError(404, "MEMORY_NOT_FOUND", `Memoria no encontrada: ${id}`);
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      this.db.connection.prepare("DELETE FROM memories WHERE id = ?").run(id);
      this.db.connection.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
      this.db.connection.exec("COMMIT");
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  updateMemory(id: string, input: { content?: string; kind?: string; scope?: string; metadata?: Record<string, unknown> }): unknown {
    const existing = this.db.connection.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!existing) throw new AppError(404, "MEMORY_NOT_FOUND", `Memoria no encontrada: ${id}`);
    const content = input.content?.trim() || existing.content as string;
    const kind = input.kind?.trim() || existing.kind as string;
    const scope = input.scope?.trim() || existing.scope as string;
    const metadata = input.metadata ?? JSON.parse(existing.metadata_json as string) as Record<string, unknown>;
    const updatedAt = new Date().toISOString();
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      this.db.connection.prepare(`UPDATE memories SET content = ?, kind = ?, scope = ?, metadata_json = ?, updated_at = ? WHERE id = ?`)
        .run(content, kind, scope, JSON.stringify(metadata), updatedAt, id);
      this.db.connection.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
      this.db.connection.prepare("INSERT INTO memories_fts (id, project_id, scope, kind, content) VALUES (?, ?, ?, ?, ?)")
        .run(id, existing.project_id, scope, kind, content);
      this.db.connection.exec("COMMIT");
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
    return { id, projectId: existing.project_id, content, kind, scope, metadata, updatedAt };
  }

  pruneMemories(days: number): number {
    const cutoff = new Date(Date.now() - Math.max(days, 1) * 86_400_000).toISOString();
    const ids = this.db.connection.prepare("SELECT id FROM memories WHERE updated_at < ?").all(cutoff) as Array<{ id: string }>;
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      for (const item of ids) this.db.connection.prepare("DELETE FROM memories_fts WHERE id = ?").run(item.id);
      this.db.connection.prepare("DELETE FROM memories WHERE updated_at < ?").run(cutoff);
      this.db.connection.exec("COMMIT");
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
    return ids.length;
  }

  documentsForVectorization(): Array<{ id: string; title: string; content: string }> {
    return this.db.connection.prepare("SELECT id, title, content FROM knowledge_documents ORDER BY updated_at")
      .all() as Array<{ id: string; title: string; content: string }>;
  }

  saveVector(documentId: string, model: string, embedding: number[]): void {
    this.db.connection.prepare(`INSERT INTO knowledge_vectors
      (document_id, model, dimensions, embedding_json, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(document_id, model) DO UPDATE SET dimensions = excluded.dimensions,
      embedding_json = excluded.embedding_json, updated_at = excluded.updated_at`)
      .run(documentId, model, embedding.length, JSON.stringify(embedding), new Date().toISOString());
  }

  vectorSearch(embedding: number[], model: string, limit = 10, packageNames?: string[]): unknown[] {
    if (packageNames && !packageNames.length) return [];
    const filter = packageNames?.length ? `AND k.package_name IN (${packageNames.map(() => "?").join(",")})` : "";
    const rows = this.db.connection.prepare(`SELECT v.document_id AS id, v.embedding_json AS embeddingJson,
      k.package_name AS packageName, k.package_version AS packageVersion, k.title, k.content,
      k.tags_json AS tagsJson FROM knowledge_vectors v JOIN knowledge_documents k ON k.id = v.document_id
      WHERE v.model = ? AND v.dimensions = ? ${filter}`).all(model, embedding.length, ...(packageNames ?? [])) as Array<Record<string, unknown>>;
    const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0)) || 1;
    return rows.map((item) => {
      const candidate = JSON.parse(item.embeddingJson as string) as number[];
      const candidateNorm = Math.sqrt(candidate.reduce((sum, value) => sum + value * value, 0)) || 1;
      const dot = candidate.reduce((sum, value, index) => sum + value * embedding[index], 0);
      return { ...item, embeddingJson: undefined, tags: JSON.parse(item.tagsJson as string), tagsJson: undefined, score: dot / (norm * candidateNorm) };
    }).sort((a, b) => (b.score as number) - (a.score as number)).slice(0, Math.min(Math.max(limit, 1), 50));
  }
}
