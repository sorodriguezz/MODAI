import type { TemplateService } from "./template-service.js";
import { manifestIdentity } from "@modai/core";
import { Database } from "./database.js";
import { AppError, invariant } from "@modai/contracts/errors";
import { ContextService } from "./context-service.js";
import { RunService } from "./run-service.js";
import { publicKeyFingerprint } from "@modai/contracts/security";
import { parseInput, publishSchema, memorySchema, projectSchema } from "@modai/contracts/schemas";
import { PackageService } from "./package-service.js";
import type { ArtifactFile, PackageSignature, PublishPackageInput, RunRecord } from "@modai/contracts/types";

interface Snapshot {
  schemaVersion: 1;
  exportedAt: string;
  packages: Array<PublishPackageInput & { status?: string; deprecatedMessage?: string }>;
  knowledge: Array<{ title: string; content: string; tags: string[]; packageName?: string }>;
  memories: Array<{ projectId: string; scope: string; kind: string; content: string; metadata: Record<string, unknown>; sessionId?: string }>;
  organizations?: Array<{ id: string; name: string; description?: string; createdAt: string }>;
  namespaces?: Array<{ name: string; organizationId?: string; description?: string; visibility?: "internal" | "restricted"; createdAt: string }>;
  projects?: Array<{ id: string; name: string; organizationId?: string; createdAt: string }>;
  runs?: RunRecord[];
  /** What each project had installed when the backup was taken (from client reports). */
  installations?: Array<{ projectId: string; packageName: string; version: string; direct: boolean; reportedAt: string }>;
  publishers: Array<{ fingerprint: string; label?: string; publicKey: string; trusted: boolean }>;
  templates?: Array<{ name: string; version: string; description: string; tags: string[]; stack?: string; status: "active" | "yanked"; publishedBy: string; files: ArtifactFile[] }>;
}

export class BackupService {
  constructor(
    private readonly db: Database,
    private readonly packages: PackageService,
    private readonly context: ContextService,
    private readonly templates?: TemplateService,
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
      organizations: this.db.connection.prepare("SELECT id, name, description, created_at AS createdAt FROM organizations").all() as Snapshot["organizations"],
      namespaces: (this.db.connection.prepare("SELECT name, organization_id AS organizationId, description, visibility, created_at AS createdAt FROM namespaces").all() as NonNullable<Snapshot["namespaces"]>)
        .map(({ organizationId, ...item }) => ({ ...item, ...(organizationId ? { organizationId } : {}) })),
      projects: this.db.connection.prepare("SELECT id, name, organization_id AS organizationId, created_at AS createdAt FROM projects").all() as Snapshot["projects"],
      runs: (this.db.connection.prepare("SELECT id FROM runs").all() as Array<{ id: string }>).map(row => new RunService(this.db).get(row.id)),
      installations: (this.db.connection.prepare(`SELECT project_id AS projectId, package_name AS packageName, version, direct, reported_at AS reportedAt
        FROM project_installations ORDER BY project_id, package_name`).all() as Array<{ projectId: string; packageName: string; version: string; direct: number; reportedAt: string }>)
        .map(item => ({ ...item, direct: Boolean(item.direct) })),
      publishers: publishers.map((item) => ({ ...item, trusted: Boolean(item.trusted) })),
      templates: this.templates ? (this.db.connection.prepare("SELECT name, version FROM templates ORDER BY name, published_at").all() as Array<{ name: string; version: string }>).map(row => {
        const { template, files } = this.templates!.files(row.name, row.version);
        return { name: template.name, version: template.version, description: template.description, tags: template.tags, ...(template.stack ? { stack: template.stack } : {}), status: template.status, publishedBy: template.publishedBy, files };
      }) : [],
    };
  }

  import(snapshot: Snapshot): { packages: number; skipped: number; knowledge: number; memories: number; installations: number } {
    invariant(snapshot?.schemaVersion === 1 && Array.isArray(snapshot.packages), 400, "INVALID_BACKUP", "Snapshot ModularAI inválido");
    // Validate every package and memory before starting an import; secrets and active leases are never restored.
    for (const item of snapshot.packages) parseInput(publishSchema, { manifest: item.manifest, files: item.files, signature: item.signature });
    for (const item of snapshot.memories ?? []) parseInput(memorySchema, item);
    for (const item of snapshot.projects ?? []) parseInput(projectSchema, { id: item.id, name: item.name, organizationId: item.organizationId ?? undefined });
    const knownProjects = new Set((snapshot.projects ?? []).map(item => item.id));
    for (const item of snapshot.installations ?? []) {
      invariant(typeof item.projectId === "string" && item.projectId.length > 0 && item.projectId.length <= 200, 400, "INVALID_BACKUP", "Instalación sin proyecto válido");
      invariant(typeof item.packageName === "string" && /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(item.packageName) && item.packageName.length <= 214, 400, "INVALID_BACKUP", `Nombre de paquete inválido en instalaciones: ${item.packageName}`);
      invariant(typeof item.version === "string" && item.version.length > 0 && item.version.length <= 100, 400, "INVALID_BACKUP", "Versión inválida en instalaciones");
      invariant(typeof item.reportedAt === "string" && !Number.isNaN(Date.parse(item.reportedAt)), 400, "INVALID_BACKUP", "Fecha inválida en instalaciones");
      invariant(knownProjects.has(item.projectId) || Boolean(this.db.connection.prepare("SELECT 1 FROM projects WHERE id = ?").get(item.projectId)), 400, "INVALID_BACKUP", `La instalación apunta a un proyecto ausente: ${item.projectId}`);
    }
    for (const item of snapshot.publishers ?? []) {
      invariant(publicKeyFingerprint(item.publicKey) === item.fingerprint, 400, "INVALID_PUBLISHER", "Fingerprint del publicador inválido");
      this.packages.registerPublisher(item.publicKey, item.label ?? "restored", item.trusted);
    }
    for (const item of snapshot.organizations ?? []) this.db.connection.prepare("INSERT OR IGNORE INTO organizations (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(item.id, item.name, item.description ?? "", item.createdAt, item.createdAt);
    for (const item of snapshot.namespaces ?? []) {
      const owner = item.organizationId && this.db.connection.prepare("SELECT 1 FROM organizations WHERE id = ?").get(item.organizationId) ? item.organizationId : null;
      this.db.connection.prepare("INSERT OR IGNORE INTO namespaces (name, organization_id, description, visibility, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'restored-admin', ?, ?)")
        .run(item.name, owner, item.description ?? "", item.visibility === "restricted" ? "restricted" : "internal", item.createdAt, item.createdAt);
    }
    for (const item of snapshot.projects ?? []) this.db.connection.prepare("INSERT OR IGNORE INTO projects (id,name,organization_id,created_by,created_at) VALUES (?, ?, ?, 'restored-admin', ?)").run(item.id,item.name,item.organizationId ?? null,item.createdAt);
    for (const item of snapshot.memories ?? []) this.db.connection.prepare("INSERT OR IGNORE INTO projects (id,name,created_by,created_at) VALUES (?, ?, 'restored-admin', ?)").run(item.projectId,item.projectId,new Date().toISOString());
    let importedPackages = 0;
    let skipped = 0;
    for (const item of snapshot.packages) {
      try {
        this.packages.publish({ manifest: item.manifest, files: item.files, signature: item.signature });
        if (item.status === "deprecated") this.packages.deprecate(manifestIdentity(item.manifest).name, manifestIdentity(item.manifest).version, item.deprecatedMessage ?? "Versión deprecada");
        if (item.status === "yanked") this.packages.yank(manifestIdentity(item.manifest).name, manifestIdentity(item.manifest).version, item.deprecatedMessage ?? "Versión retirada");
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
    // A report already on this server that is newer than the backup wins: it describes the present.
    const installation = this.db.connection.prepare(`INSERT INTO project_installations (project_id, package_name, version, direct, reported_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, package_name) DO UPDATE SET version = excluded.version, direct = excluded.direct, reported_at = excluded.reported_at
      WHERE excluded.reported_at > project_installations.reported_at`);
    for (const item of snapshot.installations ?? []) installation.run(item.projectId, item.packageName, item.version, item.direct ? 1 : 0, new Date(item.reportedAt).toISOString());
    for (const item of snapshot.publishers ?? []) {
      this.db.connection.prepare(`INSERT INTO publishers (fingerprint, label, public_key, trusted, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET label = excluded.label,
        public_key = excluded.public_key, trusted = excluded.trusted`)
        .run(item.fingerprint, item.label ?? null, item.publicKey, item.trusted ? 1 : 0, new Date().toISOString());
    }
    for (const item of snapshot.templates ?? []) {
      if (!this.templates || this.db.connection.prepare("SELECT 1 FROM templates WHERE name = ? AND version = ?").get(item.name, item.version)) continue;
      this.templates.publish({ name: item.name, version: item.version, description: item.description, tags: item.tags, stack: item.stack, files: item.files }, item.publishedBy || "restored-admin");
      if (item.status === "yanked") this.templates.setStatus(item.name, item.version, "yanked");
    }
    return { packages: importedPackages, skipped, knowledge: snapshot.knowledge?.length ?? 0, memories: snapshot.memories?.length ?? 0, installations: snapshot.installations?.length ?? 0 };
  }
}
