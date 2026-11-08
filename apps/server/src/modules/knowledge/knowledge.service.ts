import { randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import { textSearchFor } from "../../infrastructure/database/search/search-engine.js";
import { searchTerms } from "../../infrastructure/database/search/text-search.js";
import type { PackageVisibilityFilter } from "../auth/namespace-access.js";
import { assertContentBudget } from "./content-budget.js";
import { KnowledgeRepository } from "./knowledge.repository.js";
import { rankInWorker } from "./vector-search.js";

type KnowledgeInput = { title: string; content: string; tags?: string[]; packageName?: string };

const withTags = <T extends { tagsJson: string }>(item: T): Omit<T, "tagsJson"> & { tags: string[] } => ({
  ...item,
  tags: JSON.parse(item.tagsJson),
  tagsJson: undefined,
});

export class KnowledgeService {
  private readonly knowledge: KnowledgeRepository;

  constructor(private readonly context: DataContext) {
    this.knowledge = new KnowledgeRepository(context);
  }

  withContext(context: DataContext): KnowledgeService {
    return new KnowledgeService(context);
  }

  async owner(id: string): Promise<string | null> {
    const doc = await this.knowledge.find(id);
    if (!doc) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", "Documento no encontrado");
    return doc.package_name;
  }

  find(id: string) {
    return this.knowledge.find(id);
  }

  async add(input: KnowledgeInput): Promise<Record<string, unknown>> {
    invariant(
      input?.title?.trim() && input?.content?.trim(),
      400,
      "INVALID_KNOWLEDGE",
      "title y content son obligatorios",
    );
    const id = randomUUID();
    const now = new Date().toISOString();
    await assertContentBudget(this.context, input.content);
    const tags = input.tags ?? [];
    await this.knowledge.insert({
      id,
      package_name: input.packageName ?? null,
      package_version: null,
      title: input.title.trim(),
      content: input.content,
      tags_json: JSON.stringify(tags),
      created_at: now,
      updated_at: now,
    });
    return { id, ...input, tags, createdAt: now };
  }

  async list(limit = 100, offset = 0, visible?: PackageVisibilityFilter) {
    const rows = await this.knowledge.list(
      Math.min(Math.max(Math.floor(limit), 1), 500),
      Math.max(Math.floor(offset), 0),
      visible,
    );
    return rows.map(withTags);
  }

  async update(id: string, input: { title?: string; content?: string; tags?: string[] }) {
    const existing = await this.knowledge.find(id);
    if (!existing) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", `Documento no encontrado: ${id}`);
    invariant(
      !existing.package_version,
      409,
      "PACKAGE_KNOWLEDGE_IMMUTABLE",
      "El conocimiento publicado por un paquete cambia creando una nueva versión del paquete",
    );
    const title = input.title?.trim() || existing.title;
    const content = input.content?.trim() || existing.content;
    await assertContentBudget(this.context, content);
    const tags = input.tags ?? (JSON.parse(existing.tags_json) as string[]);
    const now = new Date().toISOString();
    await withTransaction(this.context, (trx) =>
      new KnowledgeRepository(trx).update(id, { title, content, tags_json: JSON.stringify(tags), updated_at: now }),
    );
    return { id, title, content, tags, updatedAt: now };
  }

  async delete(id: string): Promise<void> {
    const existing = await this.knowledge.find(id);
    if (!existing) throw new AppError(404, "KNOWLEDGE_NOT_FOUND", `Documento no encontrado: ${id}`);
    invariant(
      !existing.package_version,
      409,
      "PACKAGE_KNOWLEDGE_IMMUTABLE",
      "Retira o elimina la versión del paquete propietario",
    );
    await this.knowledge.delete(id);
  }

  async search(input: { query: string; limit?: number; packageNames?: string[] }, visible?: PackageVisibilityFilter) {
    invariant(typeof input?.query === "string" && input.query.trim(), 400, "INVALID_QUERY", "query es obligatorio");
    const terms = searchTerms(input.query);
    invariant(terms.length, 400, "INVALID_QUERY", "query no contiene términos buscables");
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
    if (input.packageNames && !input.packageNames.length) return [];
    const packageNames = input.packageNames?.filter(Boolean) ?? [];
    const hits = await textSearchFor(this.context.dialect).searchKnowledge(this.context.db, {
      terms,
      packageNames,
      limit,
      visible,
    });
    return hits.map(withTags);
  }

  async saveVector(documentId: string, model: string, embedding: number[]): Promise<void> {
    invariant(
      embedding.length > 0 &&
        embedding.length <= 8192 &&
        embedding.every(Number.isFinite) &&
        embedding.some((v) => v !== 0),
      400,
      "INVALID_VECTOR",
      "Vector inválido",
    );
    const norm = Math.hypot(...embedding);
    invariant(Number.isFinite(norm), 400, "INVALID_VECTOR", "Norma inválida");
    const blob = Buffer.alloc(embedding.length * 4);
    for (const [index, value] of embedding.entries()) blob.writeFloatLE(value / norm, index * 4);
    await this.knowledge.saveVector(documentId, model, embedding.length, blob);
  }

  async vectorSearch(
    embedding: number[],
    model: string,
    limit = 10,
    packageNames?: string[],
    visible?: PackageVisibilityFilter,
  ) {
    invariant(
      embedding.length > 0 && embedding.length <= 8192 && embedding.every(Number.isFinite),
      400,
      "INVALID_VECTOR",
      "Vector inválido",
    );
    if (packageNames && !packageNames.length) return [];
    const maxCandidates = Math.min(2000, Math.floor(2_000_000 / embedding.length));
    const rows = await this.knowledge.vectorCandidates(
      model,
      embedding.length,
      packageNames,
      maxCandidates + 1,
      visible,
    );
    invariant(
      rows.length <= maxCandidates,
      413,
      "VECTOR_CANDIDATE_LIMIT",
      "Reduce los paquetes consultados o utiliza un índice vectorial especializado",
    );
    if (!rows.length) return [];
    const candidates = rows.map((row) => ({ id: row.id, vector: new Uint8Array(row.vector) }));
    const ranks = await rankInWorker(candidates, embedding, Math.min(Math.max(limit, 1), 50));
    const results = [];
    for (const rank of ranks) {
      const document = await this.knowledge.document(rank.id, visible);
      if (document) results.push({ ...withTags(document), score: rank.score });
    }
    return results;
  }
}
