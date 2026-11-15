import { AppError } from "@modai/contracts/errors";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { KnowledgeService } from "../knowledge/knowledge.service.js";
import type { MemoryService } from "../memory/memory.service.js";
import { ProjectsRepository } from "../projects/projects.repository.js";
import type { Snapshot } from "./backup-snapshot.js";

export async function restoreKnowledge(knowledge: KnowledgeService, snapshot: Snapshot): Promise<number> {
  const catalog = snapshot.knowledge ?? [];
  const privateDocuments = snapshot.projectKnowledge ?? [];
  for (const { title, content, tags, packageName } of catalog)
    await knowledge.add({ title, content, tags, packageName });
  for (const item of privateDocuments) await knowledge.add(item);
  return catalog.length + privateDocuments.length;
}

export async function restoreMemories(
  context: DataContext,
  memory: MemoryService,
  snapshot: Snapshot,
  fallbackAuthor: string,
): Promise<void> {
  const projects = new ProjectsRepository(context);
  for (const item of snapshot.memories ?? []) {
    const organizationId =
      item.organizationId ?? (await projects.findById(item.projectId))?.organizationId ?? undefined;
    if (item.scope === "organization" && !organizationId)
      throw new AppError(400, "INVALID_BACKUP", "Falta la organización de la memoria");
    await memory.remember(item, item.createdBy ?? fallbackAuthor, organizationId, {
      approval: item.approval,
      reviewedBy: item.reviewedBy,
      reviewAt: item.reviewAt,
    });
  }
}
