import { randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import type { MemoryInput } from "@modai/contracts/types";
import type { DataContext } from "../../infrastructure/database/database.js";
import { textSearchFor } from "../../infrastructure/database/search/search-engine.js";
import { type MemoryScope, searchTerms } from "../../infrastructure/database/search/text-search.js";
import { assertContentBudget } from "../knowledge/content-budget.js";
import { MemoryRepository } from "./memory.repository.js";

type MemoryUpdate = { content?: string; kind?: string; scope?: string; metadata?: Record<string, unknown> };
type ReviewState = { approval?: number; reviewedBy?: string | null; reviewAt?: string | null };

const approvalState = (approval: number) => (approval === 1 ? "approved" : approval === 0 ? "pending" : "rejected");
const withMetadata = <T extends { metadataJson: string; personal: number; scope: string; approval: number }>({
  metadataJson,
  personal,
  scope,
  approval,
  ...item
}: T) => ({
  ...item,
  scope: personal ? "user" : scope,
  status: approvalState(approval),
  metadata: JSON.parse(metadataJson) as Record<string, unknown>,
});

export class MemoryService {
  private readonly memories: MemoryRepository;

  constructor(private readonly context: DataContext) {
    this.memories = new MemoryRepository(context);
  }

  withContext(context: DataContext): MemoryService {
    return new MemoryService(context);
  }

  async remember(
    input: MemoryInput,
    createdBy?: string,
    organizationId?: string,
    review: ReviewState = {},
  ): Promise<Record<string, unknown>> {
    invariant(
      input?.projectId?.trim() && input?.content?.trim(),
      400,
      "INVALID_MEMORY",
      "projectId y content son obligatorios",
    );
    const count = await this.memories.countForProject(input.projectId);
    invariant(count < 10000, 429, "MEMORY_QUOTA", "Límite de memorias del proyecto alcanzado");
    const id = randomUUID();
    const now = new Date().toISOString();
    const scope = input.scope?.trim() || "project";
    const kind = input.kind?.trim() || "note";
    const approval = review.approval ?? 1;
    await assertContentBudget(this.context, input.content);
    const metadata = input.metadata ?? {};
    await this.memories.insert({
      id,
      project_id: input.projectId,
      scope: scope === "user" ? "project" : scope,
      personal: scope === "user" ? 1 : 0,
      approval,
      reviewed_by: review.reviewedBy ?? null,
      review_at: review.reviewAt ?? null,
      kind,
      content: input.content,
      metadata_json: JSON.stringify(metadata),
      created_at: now,
      updated_at: now,
      organization_id: scope === "organization" ? (organizationId ?? null) : null,
      session_id: input.sessionId ?? null,
      created_by: createdBy ?? null,
    });
    return {
      id,
      projectId: input.projectId,
      scope,
      status: approvalState(approval),
      createdBy,
      kind,
      content: input.content,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getMemory(id: string) {
    const row = await this.memories.access(id);
    if (!row) throw new AppError(404, "MEMORY_NOT_FOUND", "Memoria no encontrada");
    return row;
  }

  async listMemories(projectId: string, limit = 50, options: Omit<MemoryScope, "projectId"> = {}) {
    invariant(projectId?.trim(), 400, "INVALID_PROJECT", "projectId es obligatorio");
    const rows = await this.memories.list({ projectId, ...options }, Math.min(Math.max(limit, 1), 200));
    return rows.map(withMetadata);
  }

  async searchMemories(input: MemoryScope & { query: string; limit?: number }) {
    invariant(
      input?.projectId?.trim() && input?.query?.trim(),
      400,
      "INVALID_QUERY",
      "projectId y query son obligatorios",
    );
    const terms = searchTerms(input.query);
    invariant(terms.length, 400, "INVALID_QUERY", "query no contiene términos buscables");
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 50);
    const hits = await textSearchFor(this.context.dialect).searchMemories(this.context.db, {
      terms,
      scope: input,
      limit,
    });
    return hits.map(withMetadata);
  }

  async deleteMemory(id: string): Promise<void> {
    if (!(await this.memories.find(id))) throw new AppError(404, "MEMORY_NOT_FOUND", `Memoria no encontrada: ${id}`);
    await this.memories.delete(id);
  }

  async updateMemory(id: string, input: MemoryUpdate, review: ReviewState = {}) {
    const existing = await this.memories.find(id);
    if (!existing) throw new AppError(404, "MEMORY_NOT_FOUND", `Memoria no encontrada: ${id}`);
    const content = input.content?.trim() || existing.content;
    const kind = input.kind?.trim() || existing.kind;
    invariant(
      input.scope === undefined || input.scope === (existing.personal ? "user" : existing.scope),
      400,
      "IMMUTABLE_SCOPE",
      "Para cambiar el ámbito crea una memoria nueva",
    );
    const scope = existing.scope;
    await assertContentBudget(this.context, content);
    const metadata = input.metadata ?? (JSON.parse(existing.metadata_json) as Record<string, unknown>);
    const updatedAt = new Date().toISOString();
    const approval = review.approval ?? existing.approval;
    const changed = await this.memories.review(id, existing.updated_at, {
      content,
      kind,
      scope,
      metadata_json: JSON.stringify(metadata),
      updated_at: updatedAt,
      approval,
      reviewed_by: review.reviewedBy === undefined ? existing.reviewed_by : review.reviewedBy,
      review_at: review.reviewAt === undefined ? existing.review_at : review.reviewAt,
    });
    invariant(changed, 409, "MEMORY_CHANGED", "La memoria cambió durante la edición");
    return {
      id,
      projectId: existing.project_id,
      content,
      kind,
      scope: existing.personal ? "user" : scope,
      status: approvalState(approval),
      metadata,
      updatedAt,
    };
  }

  async pending(organizationId: string) {
    return (await this.memories.pending(organizationId, new Date().toISOString())).map(withMetadata);
  }

  async review(id: string, previous: string, actor: string, approve: boolean, reviewAt?: string) {
    const now = new Date().toISOString();
    invariant(
      !reviewAt || (approve && reviewAt > now),
      400,
      "INVALID_REVIEW_DATE",
      "Indica una fecha futura al aprobar",
    );
    const approval = approve ? 1 : -1;
    const changed = await this.memories.review(id, previous, {
      approval,
      reviewed_by: actor,
      review_at: reviewAt ?? null,
      updated_at: now,
    });
    invariant(changed, 409, "MEMORY_CHANGED", "La memoria cambió durante la revisión");
    return { id, status: approvalState(approval), reviewedBy: actor, reviewAt };
  }

  async pruneMemories(days: number, dryRun = false): Promise<number> {
    const cutoff = new Date(Date.now() - Math.max(days, 0) * 86_400_000).toISOString();
    return dryRun ? this.memories.countBefore(cutoff) : this.memories.deleteBefore(cutoff);
  }
}
