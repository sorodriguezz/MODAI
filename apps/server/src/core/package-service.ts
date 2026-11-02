import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { Database } from "./database.js";
import { AppError, invariant } from "@modai/contracts/errors";
import { assertSafeRelativePath, requiredTargetPermission, sha256 } from "@modai/contracts/security";
import { publicKeyFingerprint, signaturePayload, verifyEd25519 } from "@modai/contracts/security";
import { parseInput, publishSchema } from "@modai/contracts/schemas";
import { analyzePackageQuality } from "@modai/contracts/package-quality";
import { manifestIdentity, normalizeManifest, resolve as resolveGraph, validatePackage, type Candidate } from "@modai/core";
import {
  PACKAGE_TYPES,
  isV1Manifest,
  type ArtifactFile,
  type PackageManifest,
  type PackageRecord,
  type PublishPackageInput,
  type ResolveRequest,
  type ResolvedPackage,
  type SignaturePolicy,
} from "@modai/contracts/types";

const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

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
      const publisher = this.db.connection.prepare("SELECT public_key, trusted FROM publishers WHERE fingerprint = ?").get(row.signer_fingerprint) as { public_key: string; trusted: number } | undefined;
      if (publisher) { record.signature = { algorithm: "ed25519", publicKey: publisher.public_key, signature: row.signature }; record.publisherTrusted = Boolean(publisher.trusted); }
    }
    return record;
  }

  registerPublisher(publicKey: string, label: string, trusted: boolean): string {
    const fingerprint = publicKeyFingerprint(publicKey);
    this.db.connection.prepare(`INSERT INTO publishers (fingerprint, label, public_key, trusted, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET label = excluded.label, trusted = excluded.trusted`).run(fingerprint, label, publicKey, trusted ? 1 : 0, new Date().toISOString());
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
    return rows.map(row => this.decorate(row));
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
      row = rows.sort((a, b) => semver.rcompare(a.version, b.version))[0];
    }
    if (!row) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}${version ? `@${version}` : ""}`);
    return this.decorate(row);
  }

  publish(input: PublishPackageInput): PackageRecord {
    parseInput(publishSchema, input);
    // Legacy manifests keep their historical checks; v1 manifests use the shared Core validator.
    if (isV1Manifest(input.manifest)) validatePackage(input.manifest, input.files);
    else this.validateManifest(input.manifest as PackageManifest, input.files);
    const normalized = normalizeManifest(input.manifest);
    const identity = manifestIdentity(input.manifest);
    invariant(this.signaturePolicy === "optional" || Boolean(input.signature), 400, "SIGNATURE_REQUIRED", "El servidor exige paquetes firmados");
    const { manifest, files } = input;
    const quality = analyzePackageQuality(manifest, files);
    const qualityErrors = quality.findings.filter((item) => item.severity === "error");
    invariant(!qualityErrors.length, 400, "PACKAGE_QUALITY_FAILED", qualityErrors.map((item) => item.message).join(" "));
    let signerFingerprint: string | null = null;
    if (input.signature) {
      invariant(input.signature.algorithm === "ed25519", 400, "UNSUPPORTED_SIGNATURE", "Solo se admite ed25519");
      const payload = signaturePayload(manifest, files);
      invariant(verifyEd25519(input.signature.publicKey, input.signature.signature, payload), 400, "INVALID_SIGNATURE", "La firma del paquete no es válida");
      signerFingerprint = publicKeyFingerprint(input.signature.publicKey);
    }
    if (this.signaturePolicy === "trusted") {
      const publisher = signerFingerprint ? this.db.connection.prepare("SELECT trusted FROM publishers WHERE fingerprint = ?").get(signerFingerprint) as { trusted: number } | undefined : undefined;
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
    const storage = this.db.connection.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM artifacts").get() as { n: number };
    invariant(storage.n + Buffer.byteLength(body) <= this.maxStorageBytes, 413, "STORAGE_QUOTA", "Cuota de artefactos alcanzada");
    writeFileSync(artifactPath, body, { encoding: "utf8", flag: "wx" });

    const now = new Date().toISOString();
    const connection = this.db.connection;
    try {
      connection.exec("BEGIN IMMEDIATE");
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
        connection.prepare(`INSERT INTO publishers (fingerprint, public_key, created_at)
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
      connection.exec("COMMIT");
    } catch (error) {
      try {
        connection.exec("ROLLBACK");
      } catch {}
      rmSync(artifactPath, { force: true });
      throw error;
    }
    return this.get(identity.name, identity.version);
  }

  /** Dependency and capability resolution, shared with the CLI through @modai/core. */
  async resolve(request: ResolveRequest): Promise<ResolvedPackage[]> {
    invariant(Array.isArray(request.packages) && request.packages.length > 0, 400, "INVALID_RESOLVE_REQUEST", "packages es obligatorio");
    const source = {
      versions: async (name: string): Promise<Array<Candidate<PackageRow>>> => {
        if (!PACKAGE_NAME.test(name)) return [];
        const rows = this.db.connection.prepare("SELECT * FROM packages WHERE name = ?").all(name) as unknown as PackageRow[];
        return rows.map(row => ({ version: row.version, status: row.status as PackageRecord["status"], manifest: normalizeManifest(JSON.parse(row.manifest_json)), ref: row }));
      },
    };
    const resolution = await resolveGraph(source, { roots: request.packages, overrides: request.overrides });
    return resolution.packages.map(node => this.decorate(node.ref));
  }

  getArtifact(id: string): { files: ArtifactFile[]; sha256: string } {
    const metadata = this.db.connection
      .prepare("SELECT sha256 FROM artifacts WHERE id = ?")
      .get(id) as { sha256: string } | undefined;
    if (!metadata) throw new AppError(404, "ARTIFACT_NOT_FOUND", `Artefacto no encontrado: ${id}`);
    const body = readFileSync(join(this.artifactDirectory, `${id}.json`), "utf8");
    invariant(sha256(body) === metadata.sha256, 500, "ARTIFACT_CORRUPT", `El artefacto ${id} no supera la verificación de integridad`);
    return { ...(JSON.parse(body) as { files: ArtifactFile[] }), sha256: metadata.sha256 };
  }

  deprecate(name: string, version: string, message: string): PackageRecord {
    const result = this.db.connection.prepare(`UPDATE packages SET status = 'deprecated', deprecated_message = ?
      WHERE name = ? AND version = ? AND status <> 'yanked'`).run(message.trim() || "Versión deprecada", name, version);
    if (!result.changes) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe una versión activa ${name}@${version}`);
    return this.get(name, version);
  }

  yank(name: string, version: string, reason: string): PackageRecord {
    const result = this.db.connection.prepare(`UPDATE packages SET status = 'yanked', deprecated_message = ?
      WHERE name = ? AND version = ?`).run(reason.trim() || "Versión retirada", name, version);
    if (!result.changes) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}@${version}`);
    return this.get(name, version);
  }

  hardDelete(name: string, version: string, confirmation: string): void {
    invariant(confirmation === `${name}@${version}`, 400, "CONFIRMATION_REQUIRED", `confirmation debe ser exactamente ${name}@${version}`);
    const record = this.get(name, version);
    invariant(record.status === "yanked", 409, "PACKAGE_NOT_YANKED", "Primero retira la versión con yank");
    const connection = this.db.connection;
    connection.exec("BEGIN IMMEDIATE");
    try {
      const docs = connection.prepare("SELECT id FROM knowledge_documents WHERE package_name = ? AND package_version = ?").all(name, version) as Array<{ id: string }>;
      for (const doc of docs) connection.prepare("DELETE FROM knowledge_fts WHERE id = ?").run(doc.id);
      connection.prepare("DELETE FROM knowledge_documents WHERE package_name = ? AND package_version = ?").run(name, version);
      connection.prepare("DELETE FROM packages WHERE name = ? AND version = ?").run(name, version);
      connection.prepare("DELETE FROM artifacts WHERE id = ?").run(record.artifactId);
      connection.exec("COMMIT");
      rmSync(join(this.artifactDirectory, `${record.artifactId}.json`), { force: true });
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }

  listPublishers(): unknown[] {
    return this.db.connection.prepare(`SELECT fingerprint, label, trusted,
      created_at AS createdAt FROM publishers ORDER BY created_at DESC`).all();
  }

  trustPublisher(fingerprint: string, trusted: boolean, label?: string): void {
    const result = this.db.connection.prepare("UPDATE publishers SET trusted = ?, label = COALESCE(?, label) WHERE fingerprint = ?")
      .run(trusted ? 1 : 0, label ?? null, fingerprint);
    if (!result.changes) throw new AppError(404, "PUBLISHER_NOT_FOUND", `Publicador no encontrado: ${fingerprint}`);
  }

  private validateManifest(manifest: PackageManifest, files: ArtifactFile[]): void {
    invariant(!isV1Manifest(manifest), 400, "INVALID_MANIFEST", "Manifiesto v1 en validación legacy");
    invariant(manifest?.schemaVersion === 1, 400, "INVALID_MANIFEST", "schemaVersion debe ser 1");
    invariant(PACKAGE_NAME.test(manifest.name), 400, "INVALID_PACKAGE_NAME", "El nombre debe usar el formato @scope/nombre");
    invariant(Boolean(semver.valid(manifest.version)), 400, "INVALID_VERSION", "version debe ser SemVer");
    invariant(PACKAGE_TYPES.includes(manifest.type), 400, "INVALID_PACKAGE_TYPE", `type debe ser: ${PACKAGE_TYPES.join(", ")}`);
    invariant(typeof manifest.description === "string" && manifest.description.trim().length > 0, 400, "INVALID_MANIFEST", "description es obligatorio");
    invariant(Array.isArray(files), 400, "INVALID_ARTIFACT", "files debe ser una lista");

    let totalSize = 0;
    const paths = new Set<string>();
    for (const file of files) {
      assertSafeRelativePath(file.path, "files.path");
      invariant(!paths.has(file.path), 400, "DUPLICATE_FILE", `Archivo duplicado: ${file.path}`);
      paths.add(file.path);
      const decoded = Buffer.from(file.content, "base64");
      totalSize += decoded.byteLength;
      invariant(sha256(decoded) === file.sha256, 400, "HASH_MISMATCH", `Hash incorrecto para ${file.path}`);
    }
    invariant(totalSize <= MAX_ARTIFACT_BYTES, 413, "ARTIFACT_TOO_LARGE", "El artefacto supera 25 MiB");

    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      invariant(PACKAGE_NAME.test(name) && Boolean(semver.validRange(range)), 400, "INVALID_DEPENDENCY", `Dependencia inválida: ${name}@${range}`);
    }
    for (const rule of manifest.files ?? []) {
      assertSafeRelativePath(rule.source, "files.source");
      const permission = requiredTargetPermission(rule.target);
      invariant(!permission || manifest.permissions?.includes(permission), 400, "PERMISSION_UNDECLARED", `El destino ${rule.target} requiere declarar ${permission}`);
      invariant(!rule.executable || manifest.permissions?.includes("process.execute"), 400, "PERMISSION_UNDECLARED", "Los ejecutables requieren process.execute");
      invariant(paths.has(rule.source), 400, "MISSING_SOURCE", `No existe el archivo fuente ${rule.source}`);
    }
    const names = new Set<string>();
    for (const capability of manifest.capabilities ?? []) {
      invariant(!names.has(capability.name), 400, "DUPLICATE_CAPABILITY", "Capacidad duplicada"); names.add(capability.name);
      const permission = capability.kind === "mcp" ? "mcp.connect" : capability.binding.startsWith("local:") ? "process.execute" : undefined;
      invariant(!permission || manifest.permissions?.includes(permission), 400, "PERMISSION_UNDECLARED", `La capacidad requiere ${permission}`);
    }
    invariant(manifest.type !== "agent" || Boolean(manifest.agent), 400, "AGENT_REQUIRED", "Un paquete agent necesita su definición");
    invariant(!manifest.agent || manifest.type === "agent", 400, "INVALID_AGENT", "agent solo se admite en paquetes agent");
    for (const skill of manifest.agent?.skills ?? []) invariant(Boolean(manifest.dependencies?.[skill]), 400, "AGENT_DEPENDENCY", `La skill ${skill} debe declararse como dependencia`);
    for (const rule of manifest.knowledge ?? []) {
      assertSafeRelativePath(rule.source, "knowledge.source");
      invariant(paths.has(rule.source), 400, "MISSING_SOURCE", `No existe el conocimiento ${rule.source}`);
    }
  }
}
