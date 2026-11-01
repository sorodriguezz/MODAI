import { Database } from "./database.js";
import { AppError, invariant } from "./errors.js";
import { ContextService } from "./context-service.js";
import { PackageService } from "./package-service.js";
import type { PackageSignature, PublishPackageInput } from "./types.js";

interface Snapshot {
  schemaVersion: 1;
  exportedAt: string;
  packages: Array<PublishPackageInput & { status?: string; deprecatedMessage?: string }>;
  knowledge: Array<{ title: string; content: string; tags: string[]; packageName?: string }>;
  memories: Array<{ projectId: string; scope: string; kind: string; content: string; metadata: Record<string, unknown> }>;
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
      metadata_json AS metadataJson FROM memories`).all() as Array<Record<string, unknown>>)
      .map((item) => ({ projectId: item.projectId as string, scope: item.scope as string, kind: item.kind as string, content: item.content as string, metadata: JSON.parse(item.metadataJson as string) as Record<string, unknown> }));
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      packages: packageRows,
      knowledge,
      memories,
      publishers: publishers.map((item) => ({ ...item, trusted: Boolean(item.trusted) })),
    };
  }

  import(snapshot: Snapshot): { packages: number; skipped: number; knowledge: number; memories: number } {
    invariant(snapshot?.schemaVersion === 1 && Array.isArray(snapshot.packages), 400, "INVALID_BACKUP", "Snapshot ModularAI inválido");
    let importedPackages = 0;
    let skipped = 0;
    for (const item of snapshot.packages) {
      try {
        this.packages.publish(item);
        if (item.status === "deprecated") this.packages.deprecate(item.manifest.name, item.manifest.version, item.deprecatedMessage ?? "Versión deprecada");
        if (item.status === "yanked") this.packages.yank(item.manifest.name, item.manifest.version, item.deprecatedMessage ?? "Versión retirada");
        importedPackages++;
      } catch (error) {
        if (error instanceof AppError && error.code === "PACKAGE_EXISTS") skipped++;
        else throw error;
      }
    }
    for (const item of snapshot.knowledge ?? []) this.context.addKnowledge(item);
    for (const item of snapshot.memories ?? []) this.context.remember(item);
    for (const item of snapshot.publishers ?? []) {
      this.db.connection.prepare(`INSERT INTO publishers (fingerprint, label, public_key, trusted, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET label = excluded.label,
        public_key = excluded.public_key, trusted = excluded.trusted`)
        .run(item.fingerprint, item.label ?? null, item.publicKey, item.trusted ? 1 : 0, new Date().toISOString());
    }
    return { packages: importedPackages, skipped, knowledge: snapshot.knowledge?.length ?? 0, memories: snapshot.memories?.length ?? 0 };
  }
}
