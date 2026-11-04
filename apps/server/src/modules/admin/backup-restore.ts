import { AppError, invariant } from "@modai/contracts/errors";
import { manifestIdentity } from "@modai/core";
import type { DataContext } from "../../infrastructure/database/database.js";
import { insertIgnore } from "../../infrastructure/database/upsert.js";
import type { KnowledgeService } from "../knowledge/knowledge.service.js";
import type { MemoryService } from "../memory/memory.service.js";
import type { PackagesService } from "../packages/packages.service.js";
import { PublishersRepository } from "../packages/publishers.repository.js";
import { UsageRepository } from "../packages/usage.repository.js";
import { RunsRepository } from "../runs/runs.repository.js";
import type { ImportResult, Snapshot } from "./backup-snapshot.js";

export interface RestoreServices {
  packages: PackagesService;
  knowledge: KnowledgeService;
  memory: MemoryService;
}

const ADMIN = "restored-admin";

async function restoreNamespace(context: DataContext, item: NonNullable<Snapshot["namespaces"]>[number]) {
  const ownerExists = item.organizationId
    ? await context.db.selectFrom("organizations").select("id").where("id", "=", item.organizationId).executeTakeFirst()
    : undefined;
  const visibility = item.visibility === "restricted" ? "restricted" : "internal";
  const row = {
    name: item.name,
    organization_id: ownerExists ? item.organizationId! : null,
    description: item.description ?? "",
    visibility,
  };
  await insertIgnore(
    context,
    "namespaces",
    { ...row, created_by: ADMIN, created_at: item.createdAt, updated_at: item.createdAt },
    ["name"],
  );
}

async function restoreDirectory(context: DataContext, snapshot: Snapshot): Promise<void> {
  for (const item of snapshot.organizations ?? [])
    await insertIgnore(
      context,
      "organizations",
      {
        id: item.id,
        name: item.name,
        description: item.description ?? "",
        created_at: item.createdAt,
        updated_at: item.createdAt,
      },
      ["id"],
    );
  for (const item of snapshot.namespaces ?? []) await restoreNamespace(context, item);
  for (const item of snapshot.projects ?? [])
    await insertIgnore(
      context,
      "projects",
      {
        id: item.id,
        name: item.name,
        organization_id: item.organizationId ?? null,
        created_by: ADMIN,
        created_at: item.createdAt,
      },
      ["id"],
    );
  for (const item of snapshot.memories ?? [])
    await insertIgnore(
      context,
      "projects",
      {
        id: item.projectId,
        name: item.projectId,
        organization_id: null,
        created_by: ADMIN,
        created_at: new Date().toISOString(),
      },
      ["id"],
    );
}

async function restorePackages(
  packages: PackagesService,
  snapshot: Snapshot,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0,
    skipped = 0;
  for (const item of snapshot.packages) {
    try {
      await packages.publish({ manifest: item.manifest, files: item.files, signature: item.signature });
      const { name, version } = manifestIdentity(item.manifest);
      if (item.status === "deprecated")
        await packages.deprecate(name, version, item.deprecatedMessage ?? "Versión deprecada");
      if (item.status === "yanked") await packages.yank(name, version, item.deprecatedMessage ?? "Versión retirada");
      imported++;
    } catch (error) {
      if (error instanceof AppError && error.code === "PACKAGE_EXISTS") skipped++;
      else throw error;
    }
  }
  return { imported, skipped };
}

async function restoreMemories(context: DataContext, memory: MemoryService, snapshot: Snapshot): Promise<void> {
  for (const item of snapshot.memories ?? []) {
    const project = await context.db
      .selectFrom("projects")
      .select("organization_id as organizationId")
      .where("id", "=", item.projectId)
      .executeTakeFirstOrThrow();
    invariant(
      item.scope !== "organization" || project.organizationId,
      400,
      "INVALID_BACKUP",
      "Falta la organización de la memoria",
    );
    await memory.remember(item, ADMIN, project.organizationId ?? undefined);
  }
}

async function restoreRuns(context: DataContext, snapshot: Snapshot): Promise<void> {
  const runs = new RunsRepository(context);
  for (const run of snapshot.runs ?? []) {
    invariant(
      run.bundle?.projectId === run.projectId && run.agentName === run.bundle.agent.name,
      400,
      "INVALID_BACKUP",
      "Ejecución inválida",
    );
    const running = run.status === "running";
    await runs.insertIfMissing({
      id: run.id,
      project_id: run.projectId,
      agent_name: run.agentName,
      agent_version: run.agentVersion,
      task: run.task,
      bundle_json: JSON.stringify(run.bundle),
      status: running ? "queued" : run.status,
      result: run.result ?? null,
      error: run.error ?? null,
      attempts: running ? 0 : run.attempts,
      created_by: ADMIN,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
    });
  }
}

export async function restoreSnapshot(
  context: DataContext,
  services: RestoreServices,
  snapshot: Snapshot,
): Promise<ImportResult> {
  const publishers = new PublishersRepository(context);
  for (const item of snapshot.publishers ?? [])
    await publishers.register(item.fingerprint, item.publicKey, item.label ?? "restored", item.trusted);
  await restoreDirectory(context, snapshot);
  const { imported, skipped } = await restorePackages(services.packages, snapshot);
  for (const item of snapshot.knowledge ?? []) await services.knowledge.add(item);
  await restoreMemories(context, services.memory, snapshot);
  await restoreRuns(context, snapshot);
  const usage = new UsageRepository(context);
  for (const item of snapshot.installations ?? [])
    await usage.restore({
      project_id: item.projectId,
      package_name: item.packageName,
      version: item.version,
      direct: item.direct ? 1 : 0,
      reported_at: new Date(item.reportedAt).toISOString(),
    });
  for (const item of snapshot.publishers ?? [])
    await publishers.restore(item.fingerprint, item.publicKey, item.label ?? null, item.trusted);
  return {
    packages: imported,
    skipped,
    knowledge: snapshot.knowledge?.length ?? 0,
    memories: snapshot.memories?.length ?? 0,
    installations: snapshot.installations?.length ?? 0,
  };
}
