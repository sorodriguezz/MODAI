import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppError, invariant } from "@modai/contracts/errors";
import { analyzePackageQuality } from "@modai/contracts/quality";
import { parseInput, publishSchema } from "@modai/contracts/schemas";
import { publicKeyFingerprint, sha256, signaturePayload, verifyEd25519 } from "@modai/contracts/security";
import type {
  ArtifactFile,
  PackageManifest,
  PackageRecord,
  PublishPackageInput,
  ResolvedPackage,
  ResolveRequest,
  SignaturePolicy,
} from "@modai/contracts/types";
import {
  type Candidate,
  manifestIdentity,
  normalizeManifest,
  resolve as resolveGraph,
  validatePackage,
} from "@modai/core";
import semver from "semver";
import type { Database } from "./database.js";

const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

interface PackageRow {
  name: string;
  version: string;
  type: string;
  description: string;
  manifest_json: string;
  artifact_id: string;
  published_at: string;
  status: string;
  deprecated_message: string | null;
  signer_fingerprint: string | null;
  signature: string | null;
  quality_json: string | null;
}

function rowToPackage(row: PackageRow): PackageRecord {
  return {
    name: row.name,
    version: row.version,
    type: row.type as PackageRecord["type"],
    description: row.description,
    artifactId: row.artifact_id,
    manifest: JSON.parse(row.manifest_json) as PackageManifest,
    publishedAt: row.published_at,
    status: row.status as PackageRecord["status"],
    deprecatedMessage: row.deprecated_message ?? undefined,
    signerFingerprint: row.signer_fingerprint ?? undefined,
    quality: row.quality_json ? JSON.parse(row.quality_json) : undefined,
  };
}

export class PackageService {
  constructor(
    private readonly db: Database,
    private readonly artifactDirectory: string,
    private readonly signaturePolicy: SignaturePolicy = "optional",
    private readonly maxStorageBytes = 1024 * 1024 * 1024,
  ) {
    mkdirSync(artifactDirectory, { recursive: true });
  }

  private decorate(row: PackageRow): PackageRecord {
    const record = rowToPackage(row);
    if (row.signer_fingerprint && row.signature) {
      const publisher = this.db.connection
        .prepare("SELECT public_key, trusted FROM publishers WHERE fingerprint = ?")
        .get(row.signer_fingerprint) as { public_key: string; trusted: number } | undefined;
      if (publisher) {
        record.signature = { algorithm: "ed25519", publicKey: publisher.public_key, signature: row.signature };
        record.publisherTrusted = Boolean(publisher.trusted);
      }
    }
    return record;
  }

  registerPublisher(publicKey: string, label: string, trusted: boolean): string {
    const fingerprint = publicKeyFingerprint(publicKey);
    this.db.connection
      .prepare(`INSERT INTO publishers (fingerprint, label, public_key, trusted, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET label = excluded.label, trusted = excluded.trusted`)
      .run(fingerprint, label, publicKey, trusted ? 1 : 0, new Date().toISOString());
    return fingerprint;
  }

  list(query?: string, type?: string, includeYanked = false): PackageRecord[] {
    const conditions: string[] = [];
    const params: string[] = [];
    if (query) {
      conditions.push("(name LIKE ? OR description LIKE ?)");
      params.push(`%${query}%`, `%${query}%`);
    }
    if (type) {
      conditions.push("type = ?");
      params.push(type);
    }
    if (!includeYanked) conditions.push("status <> 'yanked'");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.connection
      .prepare(`SELECT * FROM packages ${where} ORDER BY name, published_at DESC`)
      .all(...params) as unknown as PackageRow[];
    return rows.map((row) => this.decorate(row));
  }

  /**
   * One page of the catalog for the panel: filtering happens here so the browser only receives
   * the page it shows. `type` filters by what a package contributes, independent of its category.
   */
  catalog(options: {
    q?: string;
    type?: string;
    category?: string;
    status?: string;
    limit?: number;
    offset?: number;
    visible?: (name: string) => boolean;
  }): { items: Array<PackageRecord & { versions: number }>; total: number; categories: string[] } {
    const all = this.list(undefined, undefined, true).filter((item) => !options.visible || options.visible(item.name));
    const versions = new Map<string, number>();
    for (const item of all) versions.set(item.name, (versions.get(item.name) ?? 0) + 1);
    const status = options.status ?? "latest";
    let list: PackageRecord[];
    if (status === "latest") {
      // Latest active version per name; when every version is inactive the name drops out.
      const latest = new Map<string, PackageRecord>();
      for (const item of all)
        if (
          item.status === "active" &&
          (!latest.has(item.name) || item.publishedAt > latest.get(item.name)!.publishedAt)
        )
          latest.set(item.name, item);
      list = [...latest.values()];
    } else list = status === "all" ? all : all.filter((item) => item.status === status);
    const describe = (item: PackageRecord) => {
      try {
        return { manifest: normalizeManifest(item.manifest) };
      } catch {
        return undefined;
      }
    };
    const categories = [...new Set(list.map((item) => describe(item)?.manifest.spec.category ?? item.type))].sort();
    const q = options.q?.trim().toLocaleLowerCase();
    const filtered = list
      .filter((item) => {
        const info = describe(item);
        if (!info)
          return (
            !options.type &&
            !options.category &&
            (!q || `${item.name} ${item.description}`.toLocaleLowerCase().includes(q))
          );
        const { spec, kind, metadata } = info.manifest;
        if (options.category && spec.category !== options.category) return false;
        if (options.type && !CATALOG_TYPES[options.type]?.(info.manifest)) return false;
        if (!q) return true;
        return [
          item.name,
          item.description,
          spec.category,
          kind,
          ...spec.provides.map((capability) => capability.capability),
          ...(metadata.keywords ?? []),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name) || b.publishedAt.localeCompare(a.publishedAt));
    const limit = Math.min(Math.max(options.limit ?? 24, 1), 100),
      offset = Math.max(options.offset ?? 0, 0);
    return {
      items: filtered
        .slice(offset, offset + limit)
        .map((item) => ({ ...item, versions: versions.get(item.name) ?? 1 })),
      total: filtered.length,
      categories,
    };
  }

  /** Counters and latest publications for the dashboard, without sending the catalog to the browser. */
  summary(visible: (name: string) => boolean = () => true): {
    packages: number;
    versions: number;
    agents: number;
    recent: Array<{ name: string; version: string; category: string; publishedAt: string }>;
  } {
    const rows = (
      this.db.connection
        .prepare(
          "SELECT name, version, type, status, published_at AS publishedAt FROM packages ORDER BY published_at DESC",
        )
        .all() as Array<{ name: string; version: string; type: string; status: string; publishedAt: string }>
    ).filter((row) => visible(row.name));
    const counts = {
      versions: rows.length,
      packages: new Set(rows.filter((row) => row.status === "active").map((row) => row.name)).size,
    };
    const recent = rows.filter((row) => row.status !== "yanked").slice(0, 6);
    return {
      ...counts,
      agents: this.catalog({ type: "agents", limit: 1, visible }).total,
      recent: recent.map(({ type, status, ...item }) => ({ ...item, category: type })),
    };
  }

  get(name: string, version?: string): PackageRecord {
    let row: PackageRow | undefined;
    if (version) {
      row = this.db.connection
        .prepare("SELECT * FROM packages WHERE name = ? AND version = ?")
        .get(name, version) as unknown as PackageRow | undefined;
    } else {
      const rows = this.db.connection
        .prepare("SELECT * FROM packages WHERE name = ?")
        .all(name) as unknown as PackageRow[];
      // Without a version: the newest one still in use; a yanked version only when nothing else is left.
      row = rows.sort(
        (a, b) =>
          Number(a.status === "yanked") - Number(b.status === "yanked") || semver.rcompare(a.version, b.version),
      )[0];
    }
    if (!row) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}${version ? `@${version}` : ""}`);
    return this.decorate(row);
  }

  publish(input: PublishPackageInput): PackageRecord {
    parseInput(publishSchema, input);
    validatePackage(input.manifest, input.files);
    const normalized = normalizeManifest(input.manifest);
    const identity = manifestIdentity(input.manifest);
    invariant(
      this.signaturePolicy === "optional" || Boolean(input.signature),
      400,
      "SIGNATURE_REQUIRED",
      "El servidor exige paquetes firmados",
    );
    const { manifest, files } = input;
    const quality = analyzePackageQuality(manifest, files);
    const qualityErrors = quality.findings.filter((item) => item.severity === "error");
    invariant(
      !qualityErrors.length,
      400,
      "PACKAGE_QUALITY_FAILED",
      qualityErrors.map((item) => item.message).join(" "),
    );
    let signerFingerprint: string | null = null;
    if (input.signature) {
      invariant(input.signature.algorithm === "ed25519", 400, "UNSUPPORTED_SIGNATURE", "Solo se admite ed25519");
      const payload = signaturePayload(manifest, files);
      invariant(
        verifyEd25519(input.signature.publicKey, input.signature.signature, payload),
        400,
        "INVALID_SIGNATURE",
        "La firma del paquete no es válida",
      );
      signerFingerprint = publicKeyFingerprint(input.signature.publicKey);
    }
    if (this.signaturePolicy === "trusted") {
      const publisher = signerFingerprint
        ? (this.db.connection.prepare("SELECT trusted FROM publishers WHERE fingerprint = ?").get(signerFingerprint) as
            | { trusted: number }
            | undefined)
        : undefined;
      invariant(publisher?.trusted, 403, "UNTRUSTED_PUBLISHER", "El servidor exige un publicador de confianza");
    }
    const exists = this.db.connection
      .prepare("SELECT 1 AS found FROM packages WHERE name = ? AND version = ?")
      .get(identity.name, identity.version);
    invariant(!exists, 409, "PACKAGE_EXISTS", `${identity.name}@${identity.version} ya existe y es inmutable`);

    const packageCount = this.db.connection.prepare("SELECT COUNT(*) AS n FROM packages").get() as { n: number };
    invariant(packageCount.n < 20000, 429, "PACKAGE_QUOTA", "Cuota de versiones publicadas alcanzada");
    const body = JSON.stringify({ files });
    const artifactId = randomUUID();
    const artifactHash = sha256(body);
    const artifactPath = join(this.artifactDirectory, `${artifactId}.json`);
    const storage = this.db.connection.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM artifacts").get() as {
      n: number;
    };
    invariant(
      storage.n + Buffer.byteLength(body) <= this.maxStorageBytes,
      413,
      "STORAGE_QUOTA",
      "Cuota de artefactos alcanzada",
    );
    writeFileSync(artifactPath, body, { encoding: "utf8", flag: "wx" });

    const now = new Date().toISOString();
    const connection = this.db.connection;
    // A savepoint when called inside another transaction (a backup import), so the whole import can roll back.
    try {
      connection
        .transaction(() => {
          connection
            .prepare("INSERT INTO artifacts (id, sha256, size_bytes, created_at) VALUES (?, ?, ?, ?)")
            .run(artifactId, artifactHash, Buffer.byteLength(body), now);
          connection
            .prepare(`
            INSERT INTO packages
              (name, version, type, description, manifest_json, artifact_id, published_at,
               status, signer_fingerprint, signature, quality_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
          `)
            .run(
              identity.name,
              identity.version,
              normalized.spec.category,
              normalized.metadata.description,
              JSON.stringify(manifest),
              artifactId,
              now,
              signerFingerprint,
              input.signature?.signature ?? null,
              JSON.stringify(quality),
            );
          if (input.signature && signerFingerprint) {
            connection
              .prepare(`INSERT INTO publishers (fingerprint, public_key, created_at)
            VALUES (?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET public_key = excluded.public_key`)
              .run(signerFingerprint, input.signature.publicKey, now);
          }

          const byPath = new Map(files.map((file) => [file.path, file]));
          for (const rule of normalized.spec.contributes.knowledge) {
            const file = byPath.get(rule.path)!;
            const content = Buffer.from(file.content, "base64").toString("utf8");
            const id = randomUUID();
            const tags = rule.tags ?? [];
            connection
              .prepare(`
              INSERT INTO knowledge_documents
                (id, package_name, package_version, title, content, tags_json, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
              .run(id, identity.name, identity.version, rule.title, content, JSON.stringify(tags), now, now);
            connection
              .prepare("INSERT INTO knowledge_fts (id, package_name, title, content, tags) VALUES (?, ?, ?, ?, ?)")
              .run(id, identity.name, rule.title, content, tags.join(" "));
          }
        })
        .immediate();
    } catch (error) {
      rmSync(artifactPath, { force: true });
      throw error;
    }
    return this.get(identity.name, identity.version);
  }

  /** Dependency and capability resolution, shared with the CLI through @modai/core. */
  async resolve(request: ResolveRequest): Promise<ResolvedPackage[]> {
    invariant(
      Array.isArray(request.packages) && request.packages.length > 0,
      400,
      "INVALID_RESOLVE_REQUEST",
      "packages es obligatorio",
    );
    const source = {
      versions: async (name: string): Promise<Array<Candidate<PackageRow>>> => {
        if (!PACKAGE_NAME.test(name)) return [];
        const rows = this.db.connection
          .prepare("SELECT * FROM packages WHERE name = ?")
          .all(name) as unknown as PackageRow[];
        return rows.map((row) => ({
          version: row.version,
          status: row.status as PackageRecord["status"],
          manifest: normalizeManifest(JSON.parse(row.manifest_json)),
          ref: row,
        }));
      },
    };
    const resolution = await resolveGraph(source, { roots: request.packages, overrides: request.overrides });
    return resolution.packages.map((node) => this.decorate(node.ref));
  }

  /** Package that owns an artifact, so artifact downloads follow the package's visibility. */
  artifactOwner(id: string): string | undefined {
    return (
      this.db.connection.prepare("SELECT name FROM packages WHERE artifact_id = ? LIMIT 1").get(id) as
        | { name: string }
        | undefined
    )?.name;
  }

  getArtifact(id: string): { files: ArtifactFile[]; sha256: string } {
    const metadata = this.db.connection.prepare("SELECT sha256 FROM artifacts WHERE id = ?").get(id) as
      | { sha256: string }
      | undefined;
    if (!metadata) throw new AppError(404, "ARTIFACT_NOT_FOUND", `Artefacto no encontrado: ${id}`);
    const body = readFileSync(join(this.artifactDirectory, `${id}.json`), "utf8");
    invariant(
      sha256(body) === metadata.sha256,
      500,
      "ARTIFACT_CORRUPT",
      `El artefacto ${id} no supera la verificación de integridad`,
    );
    return { ...(JSON.parse(body) as { files: ArtifactFile[] }), sha256: metadata.sha256 };
  }

  deprecate(name: string, version: string, message: string): PackageRecord {
    const result = this.db.connection
      .prepare(`UPDATE packages SET status = 'deprecated', deprecated_message = ?
      WHERE name = ? AND version = ? AND status <> 'yanked'`)
      .run(message.trim() || "Versión deprecada", name, version);
    if (!result.changes)
      throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe una versión activa ${name}@${version}`);
    return this.get(name, version);
  }

  yank(name: string, version: string, reason: string): PackageRecord {
    const result = this.db.connection
      .prepare(`UPDATE packages SET status = 'yanked', deprecated_message = ?
      WHERE name = ? AND version = ?`)
      .run(reason.trim() || "Versión retirada", name, version);
    if (!result.changes) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}@${version}`);
    return this.get(name, version);
  }

  hardDelete(name: string, version: string, confirmation: string): void {
    invariant(
      confirmation === `${name}@${version}`,
      400,
      "CONFIRMATION_REQUIRED",
      `confirmation debe ser exactamente ${name}@${version}`,
    );
    const record = this.get(name, version);
    invariant(record.status === "yanked", 409, "PACKAGE_NOT_YANKED", "Primero retira la versión con yank");
    const connection = this.db.connection;
    connection
      .transaction(() => {
        const docs = connection
          .prepare("SELECT id FROM knowledge_documents WHERE package_name = ? AND package_version = ?")
          .all(name, version) as Array<{ id: string }>;
        for (const doc of docs) connection.prepare("DELETE FROM knowledge_fts WHERE id = ?").run(doc.id);
        connection
          .prepare("DELETE FROM knowledge_documents WHERE package_name = ? AND package_version = ?")
          .run(name, version);
        connection.prepare("DELETE FROM packages WHERE name = ? AND version = ?").run(name, version);
        connection.prepare("DELETE FROM artifacts WHERE id = ?").run(record.artifactId);
      })
      .immediate();
    rmSync(join(this.artifactDirectory, `${record.artifactId}.json`), { force: true });
  }

  listPublishers(): unknown[] {
    return this.db.connection
      .prepare(`SELECT fingerprint, label, trusted,
      created_at AS createdAt FROM publishers ORDER BY created_at DESC`)
      .all();
  }

  trustPublisher(fingerprint: string, trusted: boolean, label?: string): void {
    const result = this.db.connection
      .prepare("UPDATE publishers SET trusted = ?, label = COALESCE(?, label) WHERE fingerprint = ?")
      .run(trusted ? 1 : 0, label ?? null, fingerprint);
    if (!result.changes) throw new AppError(404, "PUBLISHER_NOT_FOUND", `Publicador no encontrado: ${fingerprint}`);
  }
}

/** "What is it?" filters of the catalog; they read contributions, never interpret categories beyond equality. */
const CATALOG_TYPES: Record<string, (manifest: ReturnType<typeof normalizeManifest>) => boolean> = {
  components: (manifest) => manifest.spec.contributes.components.length > 0 || manifest.spec.category === "component",
  harness: (manifest) => manifest.spec.category === "harness",
  skills: (manifest) => manifest.spec.contributes.skills.length > 0,
  tools: (manifest) => manifest.spec.contributes.tools.length + manifest.spec.contributes.mcpServers.length > 0,
  agents: (manifest) => manifest.spec.contributes.agents.length > 0,
  knowledge: (manifest) => manifest.spec.contributes.knowledge.length > 0,
  profiles: (manifest) => manifest.kind === "Profile" || manifest.spec.category === "profile",
  templates: (manifest) => manifest.kind === "Template",
  adapters: (manifest) => manifest.kind === "Adapter" || manifest.spec.category === "adapter",
};
