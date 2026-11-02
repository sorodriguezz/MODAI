import { Database } from "./database.js";
import { AppError, invariant } from "@modai/contracts/errors";
import { ContextService } from "./context-service.js";
import { RunService } from "./run-service.js";
import { publicKeyFingerprint } from "@modai/contracts/security";
import { parseInput, publishSchema, memorySchema, projectSchema } from "@modai/contracts/schemas";
import { PackageService } from "./package-service.js";
import type { PackageSignature, PublishPackageInput, RunRecord } from "@modai/contracts/types";

interface Snapshot {
  schemaVersion: 1;
  exportedAt: string;
  packages: Array<PublishPackageInput & { status?: string; deprecatedMessage?: string }>;
  knowledge: Array<{ title: string; content: string; tags: string[]; packageName?: string }>;
  memories: Array<{ projectId: string; scope: string; kind: string; content: string; metadata: Record<string, unknown>; sessionId?: string }>;
  organizations?: Array<{ id: string; name: string; createdAt: string }>;
  projects?: Array<{ id: string; name: string; organizationId?: string; createdAt: string }>;
  runs?: RunRecord[];
  publishers: Array<{ fingerprint: string; label?: string; publicKey: string; trusted: boolean }>;
}

export class BackupService {
  constructor(
    private readonly db: Database,
    private readonly packages: PackageService,
    private readonly context: ContextService,
  ) {}

  export(): Snapshot {
    const publishers = this.db.connection.prepare(`SELECT fingerprint, label, public_key AS publicKey,
      trusted FROM publishers`).all() as Array<{ fingerprint: string; label?: string; publicKey: string; trusted: number }>;
    const publicKeys = new Map(publishers.map((item) => [item.fingerprint, item.publicKey]));
    const packageRows = this.packages.list(undefined, undefined, true).map((item) => {
      const artifact = this.packages.getArtifact(item.artifactId);
      let signature: PackageSignature | undefined;
      const row = this.db.connection.prepare("SELECT signature FROM packages WHERE name = ? AND version = ?").get(item.name, item.version) as { signature?: string } | undefined;
      const publicKey = item.signerFingerprint ? publicKeys.get(item.signerFingerprint) : undefined;
      if (row?.signature && publicKey) signature = { algorithm: "ed25519", publicKey, signature: row.signature };
      return { manifest: item.manifest, files: artifact.files, signature, status: item.status, deprecatedMessage: item.deprecatedMessage };
    });
    const knowledge = (this.db.connection.prepare(`SELECT package_name AS packageName, title, content,
      tags_json AS tagsJson FROM knowledge_documents WHERE package_version IS NULL`).all() as Array<Record<string, unknown>>)
      .map((item) => ({ packageName: item.packageName as string | undefined, title: item.title as string, content: item.content as string, tags: JSON.parse(item.tagsJson as string) as string[] }));
    const memories = (this.db.connection.prepare(`SELECT project_id AS projectId, scope, kind, content,
      metadata_json AS metadataJson, session_id AS sessionId FROM memories`).all() as Array<Record<string, unknown>>)
      .map((item) => ({ projectId: item.projectId as string, scope: item.scope as string, kind: item.kind as string, content: item.content as string, metadata: JSON.parse(item.metadataJson as string) as Record<string, unknown>, sessionId: (item.sessionId as string | null) ?? undefined }));
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      packages: packageRows,
      knowledge,
      memories,
      organizations: this.db.connection.prepare("SELECT id, name, created_at AS createdAt FROM organizations").all() as Snapshot["organizations"],
      projects: this.db.connection.prepare("SELECT id, name, organization_id AS organizationId, created_at AS createdAt FROM projects").all() as Snapshot["projects"],
      runs: (this.db.connection.prepare("SELECT id FROM runs").all() as Array<{ id: string }>).map(row => new RunService(this.db).get(row.id)),
      publishers: publishers.map((item) => ({ ...item, trusted: Boolean(item.trusted) })),
    };
  }

  import(snapshot: Snapshot): { packages: number; skipped: number; knowledge: number; memories: number } {
    invariant(snapshot?.schemaVersion === 1 && Array.isArray(snapshot.packages), 400, "INVALID_BACKUP", "Snapshot ModularAI inválido");
    // Validate every package and memory before starting an import; secrets and active leases are never restored.
    for (const item of snapshot.packages) parseInput(publishSchema, { manifest: item.manifest, files: item.files, signature: item.signature });
    for (const item of snapshot.memories ?? []) parseInput(memorySchema, item);
    for (const item of snapshot.projects ?? []) parseInput(projectSchema, { id: item.id, name: item.name, organizationId: item.organizationId ?? undefined });
    for (const item of snapshot.publishers ?? []) {
      invariant(publicKeyFingerprint(item.publicKey) === item.fingerprint, 400, "INVALID_PUBLISHER", "Fingerprint del publicador inválido");
      this.packages.registerPublisher(item.publicKey, item.label ?? "restored", item.trusted);
    }
    for (const item of snapshot.organizations ?? []) this.db.connection.prepare("INSERT OR IGNORE INTO organizations VALUES (?, ?, ?)").run(item.id,item.name,item.createdAt);
    for (const item of snapshot.projects ?? []) this.db.connection.prepare("INSERT OR IGNORE INTO projects (id,name,organization_id,created_by,created_at) VALUES (?, ?, ?, 'restored-admin', ?)").run(item.id,item.name,item.organizationId ?? null,item.createdAt);
    for (const item of snapshot.memories ?? []) this.db.connection.prepare("INSERT OR IGNORE INTO projects (id,name,created_by,created_at) VALUES (?, ?, 'restored-admin', ?)").run(item.projectId,item.projectId,new Date().toISOString());
    let importedPackages = 0;
    let skipped = 0;
    for (const item of snapshot.packages) {
      try {
        this.packages.publish({ manifest: item.manifest, files: item.files, signature: item.signature });
        if (item.status === "deprecated") this.packages.deprecate(item.manifest.name, item.manifest.version, item.deprecatedMessage ?? "Versión deprecada");
        if (item.status === "yanked") this.packages.yank(item.manifest.name, item.manifest.version, item.deprecatedMessage ?? "Versión retirada");
        importedPackages++;
      } catch (error) {
        if (error instanceof AppError && error.code === "PACKAGE_EXISTS") skipped++;
        else throw error;
      }
    }
    for (const item of snapshot.knowledge ?? []) this.context.addKnowledge(item);
    for (const item of snapshot.memories ?? []) {
      const project = this.db.connection.prepare("SELECT organization_id AS organizationId FROM projects WHERE id = ?").get(item.projectId) as { organizationId?: string };
      invariant(item.scope !== "organization" || project.organizationId, 400, "INVALID_BACKUP", "Falta la organización de la memoria");
      this.context.remember(item,"restored-admin",project.organizationId);
    }
    for (const run of snapshot.runs ?? []) {
      invariant(run.bundle?.projectId === run.projectId && run.agentName === run.bundle.agent.name, 400, "INVALID_BACKUP", "Ejecución inválida");
      this.db.connection.prepare(`INSERT OR IGNORE INTO runs (id,project_id,agent_name,agent_version,task,bundle_json,status,result,error,attempts,created_by,created_at,updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'restored-admin', ?, ?)`).run(run.id,run.projectId,run.agentName,run.agentVersion,run.task,JSON.stringify(run.bundle),run.status === "running" ? "queued" : run.status,run.result ?? null,run.error ?? null,run.status === "running" ? 0 : run.attempts,run.createdAt,run.updatedAt);
    }
    for (const item of snapshot.publishers ?? []) {
      this.db.connection.prepare(`INSERT INTO publishers (fingerprint, label, public_key, trusted, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET label = excluded.label,
        public_key = excluded.public_key, trusted = excluded.trusted`)
        .run(item.fingerprint, item.label ?? null, item.publicKey, item.trusted ? 1 : 0, new Date().toISOString());
    }
    return { packages: importedPackages, skipped, knowledge: snapshot.knowledge?.length ?? 0, memories: snapshot.memories?.length ?? 0 };
  }
}
