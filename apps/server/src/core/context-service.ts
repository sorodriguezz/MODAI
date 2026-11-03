import { randomUUID } from "node:crypto";
import { Database } from "./database.js";
import { AppError, invariant } from "@modai/contracts/errors";
import { rankVectors, rankInWorker, type VectorCandidate } from "./vector-search.js";
import type { MemoryInput } from "@modai/contracts/types";

function ftsQuery(input: string): string {
  const terms = input.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(terms)].slice(0, 12).map((term) => `"${term.replaceAll('"', '""')}"*`).join(" OR ");
}

export class ContextService {
  constructor(private readonly db: Database) {}

  private assertContentBudget(content: string): void {
    invariant(typeof content === "string" && Buffer.byteLength(content) <= 250_000, 413, "CONTENT_TOO_LARGE", "El contenido supera 250 kB");
    const total = this.db.connection.prepare("SELECT (SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) FROM knowledge_documents) + (SELECT COALESCE(SUM(length(CAST(content AS BLOB))),0) FROM memories) AS n").get() as { n: number };
    invariant(total.n + Buffer.byteLength(content) <= 128 * 1024 * 1024, 413, "CONTEXT_QUOTA", "Cuota de contexto alcanzada");
  }

  addKnowledge(input: { title: string; content: string; tags?: string[]; packageName?: string }): Record<string, unknown> {
    invariant(input?.title?.trim() && input?.content?.trim(), 400, "INVALID_KNOWLEDGE", "title y content son obligatorios");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.assertContentBudget(input.content);
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
    this.assertContentBudget(content);
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
    if (input.packageNames && !input.packageNames.length) return [];
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

  remember(input: MemoryInput, createdBy?: string, organizationId?: string): Record<string, unknown> {
    invariant(input?.projectId?.trim() && input?.content?.trim(), 400, "INVALID_MEMORY", "projectId y content son obligatorios");
    const count = this.db.connection.prepare("SELECT COUNT(*) AS n FROM memories WHERE project_id = ?").get(input.projectId) as { n: number };
    invariant(count.n < 10000, 429, "MEMORY_QUOTA", "Límite de memorias del proyecto alcanzado");
    const id = randomUUID();
    const now = new Date().toISOString();
    const scope = input.scope?.trim() || "project";
    const kind = input.kind?.trim() || "note";
    this.assertContentBudget(input.content);
    const metadata = input.metadata ?? {};
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      this.db.connection
        .prepare(`INSERT INTO memories
          (id, project_id, scope, kind, content, metadata_json, created_at, updated_at, organization_id, session_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.projectId, scope, kind, input.content, JSON.stringify(metadata), now, now, scope === "organization" ? organizationId ?? null : null, input.sessionId ?? null, createdBy ?? null);
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

  getMemory(id: string): { projectId: string; scope: string; organizationId?: string; sessionId?: string } {
    const row = this.db.connection.prepare("SELECT project_id AS projectId, scope, organization_id AS organizationId, session_id AS sessionId FROM memories WHERE id = ?").get(id) as { projectId: string; scope: string; organizationId?: string; sessionId?: string } | undefined;
    if (!row) throw new AppError(404, "MEMORY_NOT_FOUND", "Memoria no encontrada");
    return row;
  }

  private memoryFilter(projectId: string, options: { organizationId?: string; sessionId?: string }) {
    const clauses = ["(m.project_id = ? AND m.scope = 'project')"];
    const values: string[] = [projectId];
    if (options.sessionId) { clauses.push("(m.project_id = ? AND m.scope = 'session' AND m.session_id = ?)"); values.push(projectId, options.sessionId); }
    if (options.organizationId) { clauses.push("(m.organization_id = ? AND m.scope = 'organization')"); values.push(options.organizationId); }
    return { sql: clauses.join(" OR "), values };
  }

  listMemories(projectId: string, limit = 50, options: { organizationId?: string; sessionId?: string } = {}): unknown[] {
    invariant(projectId?.trim(), 400, "INVALID_PROJECT", "projectId es obligatorio");
    const filter = this.memoryFilter(projectId, options);
    return this.db.connection.prepare(`SELECT m.id, m.project_id AS projectId, m.scope, m.kind, m.content,
      m.organization_id AS organizationId, m.session_id AS sessionId, m.metadata_json AS metadataJson,
      m.created_at AS createdAt, m.updated_at AS updatedAt FROM memories m WHERE ${filter.sql} ORDER BY m.updated_at DESC LIMIT ?`)
      .all(...filter.values, Math.min(Math.max(limit, 1), 200)).map(row => {
        const item = row as Record<string, unknown>;
        return { ...item, metadata: JSON.parse(item.metadataJson as string), metadataJson: undefined };
      });
  }

  searchMemories(input: { projectId: string; query: string; limit?: number; organizationId?: string; sessionId?: string }): unknown[] {
    invariant(input?.projectId?.trim() && input?.query?.trim(), 400, "INVALID_QUERY", "projectId y query son obligatorios");
    const query = ftsQuery(input.query);
    invariant(query, 400, "INVALID_QUERY", "query no contiene términos buscables");
    const filter = this.memoryFilter(input.projectId, input);
    return this.db.connection.prepare(`SELECT m.id, m.project_id AS projectId, m.scope, m.kind, m.content,
      m.organization_id AS organizationId, m.session_id AS sessionId, m.metadata_json AS metadataJson,
      m.created_at AS createdAt, m.updated_at AS updatedAt, bm25(memories_fts, 0, 0, 0, 1, 2) AS rank
      FROM memories_fts JOIN memories m ON m.id = memories_fts.id
      WHERE memories_fts MATCH ? AND (${filter.sql}) ORDER BY rank LIMIT ?`)
      .all(query, ...filter.values, Math.min(Math.max(Number(input.limit) || 10, 1), 50)).map(row => {
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
    invariant(input.scope === undefined || input.scope === existing.scope, 400, "IMMUTABLE_SCOPE", "Para cambiar el ámbito crea una memoria nueva");
    const scope = existing.scope as string;
    this.assertContentBudget(content);
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

  /** Deletes memories not updated in `days` days (0 = all of them). `dryRun` only counts. */
  pruneMemories(days: number, dryRun = false): number {
    const cutoff = new Date(Date.now() - Math.max(days, 0) * 86_400_000).toISOString();
    const ids = this.db.connection.prepare("SELECT id FROM memories WHERE updated_at < ?").all(cutoff) as Array<{ id: string }>;
    if (dryRun) return ids.length;
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
    invariant(embedding.length > 0 && embedding.length <= 8192 && embedding.every(Number.isFinite) && embedding.some(v => v !== 0), 400, "INVALID_VECTOR", "Vector inválido");
    const norm = Math.hypot(...embedding);
    invariant(Number.isFinite(norm), 400, "INVALID_VECTOR", "Norma inválida");
    const blob = Buffer.alloc(embedding.length * 4);
    embedding.forEach((value,index) => blob.writeFloatLE(value / norm,index * 4));
    this.db.connection.prepare(`INSERT INTO knowledge_vectors
      (document_id, model, dimensions, embedding_blob, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(document_id, model) DO UPDATE SET dimensions = excluded.dimensions,
      embedding_blob = excluded.embedding_blob, updated_at = excluded.updated_at`)
      .run(documentId, model, embedding.length, blob, new Date().toISOString());
  }

  private vectorCandidates(embedding: number[], model: string, packageNames?: string[]): VectorCandidate[] {
    invariant(embedding.length > 0 && embedding.length <= 8192 && embedding.every(Number.isFinite), 400, "INVALID_VECTOR", "Vector inválido");
    if (packageNames && !packageNames.length) return [];
    const filter = packageNames?.length ? `AND k.package_name IN (${packageNames.map(() => "?").join(",")})` : "";
    const parameters = [model, embedding.length, ...(packageNames ?? [])];
    const maxCandidates = Math.min(2000, Math.floor(2_000_000 / embedding.length));
    const rows = this.db.connection.prepare(`SELECT v.document_id AS id, v.embedding_blob AS vector FROM knowledge_vectors v JOIN knowledge_documents k ON k.id = v.document_id WHERE v.model = ? AND v.dimensions = ? ${filter} LIMIT ?`).all(...parameters, maxCandidates + 1) as Array<{ id: string; vector: Buffer }>;
    invariant(rows.length <= maxCandidates, 413, "VECTOR_CANDIDATE_LIMIT", "Reduce los paquetes consultados o utiliza un índice vectorial especializado");
    return rows.map(row => ({ id: row.id, vector: row.vector }));
  }
  private vectorResults(ranks: Array<{ id: string; score: number }>): unknown[] {
    const get = this.db.connection.prepare(`SELECT id, package_name AS packageName, package_version AS packageVersion, title, content, tags_json AS tagsJson FROM knowledge_documents WHERE id = ?`);
    return ranks.map(rank => { const row = get.get(rank.id) as Record<string, unknown>; return { ...row, tags: JSON.parse(row.tagsJson as string), tagsJson: undefined, score: rank.score }; });
  }
  vectorSearch(embedding: number[], model: string, limit = 10, packageNames?: string[]): unknown[] {
    return this.vectorResults(rankVectors(this.vectorCandidates(embedding,model,packageNames),embedding,Math.min(Math.max(limit,1),50)));
  }
  async vectorSearchAsync(embedding: number[], model: string, limit = 10, packageNames?: string[]): Promise<unknown[]> {
    const candidates=this.vectorCandidates(embedding,model,packageNames);
    if(!candidates.length)return [];
    return this.vectorResults(await rankInWorker(candidates,embedding,Math.min(Math.max(limit,1),50)));
  }
}
