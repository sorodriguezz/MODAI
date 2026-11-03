import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { AppError, invariant } from "@modai/contracts/errors";
import { assertSafeRelativePath, sha256 } from "@modai/contracts/security";
import type { ArtifactFile } from "@modai/contracts/types";
import { readZip, writeZip, type ArchiveEntry } from "@modai/core";
import { Database } from "./database.js";

/**
 * Project templates: a whole starter project (for example NestJS with SDD) published under a namespace like a package,
 * immutable per version, downloadable as ZIP or as files for `modai template use`. They share the artifact quota.
 */
export interface TemplateRecord { name: string; version: string; description: string; tags: string[]; stack?: string; files: number; sizeBytes: number; publishedAt: string; publishedBy: string; status: "active" | "yanked"; versions?: number }
export interface TemplateInput { name: string; version: string; description: string; tags?: string[]; stack?: string; archive?: string; files?: ArtifactFile[] }

const NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;
const MAX_BYTES = 25 * 1024 * 1024;
/** Never part of a template: dependencies, build output, VCS data and local secrets. */
const EXCLUDED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.turbo|\.modai\/store|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/;

type Row = { name: string; version: string; description: string; tags_json: string; stack: string | null; artifact_id: string; files: number; size_bytes: number; published_at: string; published_by: string; status: "active" | "yanked" };
const toRecord = (row: Row): TemplateRecord => ({ name: row.name, version: row.version, description: row.description, tags: JSON.parse(row.tags_json), ...(row.stack ? { stack: row.stack } : {}), files: row.files, sizeBytes: row.size_bytes, publishedAt: row.published_at, publishedBy: row.published_by, status: row.status });

export class TemplateService {
  private readonly directory: string;

  constructor(private readonly db: Database, artifactDirectory: string, private readonly maxStorageBytes = 1024 * 1024 * 1024) {
    this.directory = join(artifactDirectory, "templates");
    mkdirSync(this.directory, { recursive: true });
    db.connection.exec(`CREATE TABLE IF NOT EXISTS templates (
      name TEXT NOT NULL, version TEXT NOT NULL, description TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]', stack TEXT,
      artifact_id TEXT NOT NULL, files INTEGER NOT NULL, size_bytes INTEGER NOT NULL,
      published_at TEXT NOT NULL, published_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (name, version));
      CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);`);
  }

  /** Latest active version of each template, with its version count. */
  list(visible: (name: string) => boolean, query?: string): TemplateRecord[] {
    const rows = (this.db.connection.prepare("SELECT * FROM templates ORDER BY name").all() as Row[]).filter(row => visible(row.name));
    const byName = new Map<string, Row[]>();
    for (const row of rows) byName.set(row.name, [...(byName.get(row.name) ?? []), row]);
    const q = query?.trim().toLocaleLowerCase();
    return [...byName.values()].flatMap(versions => {
      const active = versions.filter(row => row.status === "active").sort((a, b) => semver.rcompare(a.version, b.version));
      if (!active.length) return [];
      const latest = toRecord(active[0]!);
      if (q && ![latest.name, latest.description, latest.stack ?? "", ...latest.tags].join(" ").toLocaleLowerCase().includes(q)) return [];
      return [{ ...latest, versions: versions.length }];
    });
  }

  versions(name: string): TemplateRecord[] {
    return (this.db.connection.prepare("SELECT * FROM templates WHERE name = ?").all(name) as Row[]).map(toRecord).sort((a, b) => semver.rcompare(a.version, b.version));
  }

  get(name: string, version?: string): TemplateRecord & { artifactId: string } {
    const rows = (this.db.connection.prepare("SELECT * FROM templates WHERE name = ?").all(name) as Row[]);
    const row = version
      ? rows.find(item => item.version === version)
      : rows.filter(item => item.status === "active").sort((a, b) => semver.rcompare(a.version, b.version))[0];
    if (!row) throw new AppError(404, "TEMPLATE_NOT_FOUND", `No existe el template ${name}${version ? "@" + version : ""}`);
    return { ...toRecord(row), artifactId: row.artifact_id };
  }

  publish(input: TemplateInput, actor: string): TemplateRecord {
    invariant(NAME.test(input.name), 400, "INVALID_TEMPLATE", "El nombre es @namespace/nombre, en minúsculas");
    invariant(Boolean(semver.valid(input.version)), 400, "INVALID_TEMPLATE", "La versión debe ser SemVer (1.0.0)");
    const description = String(input.description ?? "").trim();
    invariant(description.length > 0 && description.length <= 2000, 400, "INVALID_TEMPLATE", "La descripción es obligatoria (máx. 2000 caracteres)");
    if (this.db.connection.prepare("SELECT 1 FROM templates WHERE name = ? AND version = ?").get(input.name, input.version)) throw new AppError(409, "TEMPLATE_EXISTS", `${input.name}@${input.version} ya existe: las versiones son inmutables, publica una nueva`);
    let entries: ArchiveEntry[];
    try {
      if (input.archive) entries = readZip(Buffer.from(input.archive, "base64"));
      else entries = (input.files ?? []).map(file => {
        assertSafeRelativePath(file.path, "path");
        const bytes = Buffer.from(file.content, "base64");
        invariant(sha256(bytes) === file.sha256, 400, "INVALID_TEMPLATE", `Integridad inválida en ${file.path}`);
        return { path: file.path.replaceAll("\\", "/"), bytes };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, "INVALID_TEMPLATE", (error as Error).message);
    }
    // A ZIP made from a folder usually wraps everything in that folder: drop it.
    const roots = new Set(entries.map(entry => entry.path.split("/")[0]));
    if (roots.size === 1 && entries.every(entry => entry.path.includes("/"))) { const root = [...roots][0]!; entries = entries.map(entry => ({ path: entry.path.slice(root.length + 1), bytes: entry.bytes })); }
    entries = entries.filter(entry => !EXCLUDED.test(entry.path));
    invariant(entries.length > 0, 400, "INVALID_TEMPLATE", "El template no tiene archivos (se excluyen node_modules, .git, dist y .env)");
    const size = entries.reduce((total, entry) => total + entry.bytes.length, 0);
    invariant(size <= MAX_BYTES, 413, "TEMPLATE_TOO_LARGE", "El template supera 25 MiB");
    const body = JSON.stringify({ files: entries.map(entry => ({ path: entry.path, content: entry.bytes.toString("base64"), sha256: sha256(entry.bytes) })) });
    const storage = this.db.connection.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS n FROM artifacts").get() as { n: number };
    invariant(storage.n + Buffer.byteLength(body) <= this.maxStorageBytes, 413, "STORAGE_QUOTA", "Cuota de artefactos alcanzada");
    const id = "tpl-" + randomUUID(), now = new Date().toISOString();
    writeFileSync(join(this.directory, `${id}.json`), body, "utf8");
    try {
      this.db.connection.transaction(() => {
        this.db.connection.prepare("INSERT INTO artifacts (id, sha256, size_bytes, created_at) VALUES (?, ?, ?, ?)").run(id, sha256(body), Buffer.byteLength(body), now);
        this.db.connection.prepare(`INSERT INTO templates (name, version, description, tags_json, stack, artifact_id, files, size_bytes, published_at, published_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(input.name, input.version, description, JSON.stringify((input.tags ?? []).map(tag => String(tag).trim().slice(0, 40)).filter(Boolean).slice(0, 20)), input.stack?.trim().slice(0, 200) || null, id, entries.length, size, now, actor);
      })();
    } catch (error) {
      rmSync(join(this.directory, `${id}.json`), { force: true });
      throw error;
    }
    return this.get(input.name, input.version);
  }

  files(name: string, version?: string): { template: TemplateRecord; files: ArtifactFile[] } {
    const template = this.get(name, version);
    const body = readFileSync(join(this.directory, `${template.artifactId}.json`), "utf8");
    const stored = this.db.connection.prepare("SELECT sha256 FROM artifacts WHERE id = ?").get(template.artifactId) as { sha256: string } | undefined;
    invariant(stored?.sha256 === sha256(body), 500, "ARTIFACT_CORRUPT", "El template no supera la verificación de integridad");
    const { artifactId, ...record } = template;
    return { template: record, files: (JSON.parse(body) as { files: ArtifactFile[] }).files };
  }

  zip(name: string, version?: string): { template: TemplateRecord; zip: Buffer } {
    const { template, files } = this.files(name, version);
    const folder = name.split("/")[1]!;
    return { template, zip: writeZip(files.map(file => ({ path: `${folder}/${file.path}`, bytes: Buffer.from(file.content, "base64") }))) };
  }

  /** Yanked versions stay downloadable by exact version but leave the listing and "latest". */
  setStatus(name: string, version: string, status: "active" | "yanked"): TemplateRecord {
    const changed = this.db.connection.prepare("UPDATE templates SET status = ? WHERE name = ? AND version = ?").run(status, name, version);
    invariant(changed.changes > 0, 404, "TEMPLATE_NOT_FOUND", `No existe el template ${name}@${version}`);
    return this.get(name, version);
  }
}
