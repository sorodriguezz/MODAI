import type { DataContext } from "../../infrastructure/database/database.js";
import { KnowledgeRepository } from "../knowledge/knowledge.repository.js";
import { MemoryRepository } from "../memory/memory.repository.js";
import type { PackagesService } from "../packages/packages.service.js";
import { PublishersRepository } from "../packages/publishers.repository.js";
import { UsageRepository } from "../packages/usage.repository.js";
import { RunsRepository, toRun } from "../runs/runs.repository.js";
import type { Snapshot } from "./backup-snapshot.js";

async function exportPackages(packages: PackagesService): Promise<Snapshot["packages"]> {
  const items = [];
  for (const item of await packages.list(undefined, undefined, true)) {
    const artifact = await packages.getArtifact(item.artifactId);
    items.push({
      manifest: item.manifest,
      files: artifact.files,
      signature: item.signature,
      status: item.status,
      deprecatedMessage: item.deprecatedMessage,
    });
  }
  return items;
}

async function exportDirectory(context: DataContext) {
  const organizations = await context.db
    .selectFrom("organizations")
    .select(["id", "name", "description", "created_at as createdAt"])
    .execute();
  const namespaces = await context.db
    .selectFrom("namespaces")
    .select(["name", "organization_id as organizationId", "description", "visibility", "created_at as createdAt"])
    .execute();
  const projects = await context.db
    .selectFrom("projects")
    .select(["id", "name", "organization_id as organizationId", "created_at as createdAt"])
    .execute();
  return {
    organizations,
    namespaces: namespaces.map(({ organizationId, visibility, ...item }) => ({
      ...item,
      visibility: visibility as "internal" | "restricted",
      ...(organizationId ? { organizationId } : {}),
    })),
    projects: projects as Snapshot["projects"],
  };
}

export async function exportSnapshot(context: DataContext, packages: PackagesService): Promise<Snapshot> {
  const publishers = await new PublishersRepository(context).exportAll();
  const knowledge = await new KnowledgeRepository(context).exportManual();
  const memories = await new MemoryRepository(context).exportAll();
  const runs = new RunsRepository(context);
  const runRecords = [];
  for (const id of await runs.ids()) runRecords.push(toRun((await runs.find(id))!));
  const installations = await new UsageRepository(context).all();
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    packages: await exportPackages(packages),
    knowledge: knowledge.map((item) => ({
      packageName: item.packageName as string | undefined,
      title: item.title,
      content: item.content,
      tags: JSON.parse(item.tagsJson) as string[],
    })),
    memories: memories.map((item) => ({
      projectId: item.projectId,
      scope: item.scope,
      kind: item.kind,
      content: item.content,
      metadata: JSON.parse(item.metadataJson) as Record<string, unknown>,
      sessionId: item.sessionId ?? undefined,
    })),
    ...(await exportDirectory(context)),
    runs: runRecords,
    installations: installations.map((item) => ({ ...item, direct: Boolean(item.direct) })),
    publishers: publishers.map((item) => ({
      ...item,
      label: item.label as string | undefined,
      trusted: Boolean(item.trusted),
    })),
  };
}
