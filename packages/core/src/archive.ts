import { deflateRawSync, inflateRawSync } from "node:zlib";
import YAML from "yaml";
import { assertSafeRelativePath, sha256 } from "@modai/contracts/security";
import type { ArtifactFile, PublishPackageInput } from "@modai/contracts/types";
import { TEMPLATE_MANIFEST } from "./template-spec.js";

/**
 * Minimal ZIP support for `.skill` files and project templates: stored and deflate entries, no encryption,
 * no ZIP64. Paths are validated like any package path, and size limits stop zip bombs before inflating.
 */
export interface ArchiveEntry { path: string; bytes: Buffer }

/** Code-point order, like the rest of the Core, so archives are stable across locales. */
const byPath = (a: ArchiveEntry, b: ArchiveEntry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git|node_modules)(\/|$)/;

export function readZip(archive: Buffer, limits: { maxBytes?: number } = {}): ArchiveEntry[] {
  const maxBytes = limits.maxBytes ?? MAX_TOTAL_BYTES;
  let end = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("El archivo no es un ZIP válido (falta el directorio central)");
  const count = archive.readUInt16LE(end + 10);
  if (count > MAX_ENTRIES) throw new Error(`El ZIP tiene demasiadas entradas (${count}; máximo ${MAX_ENTRIES})`);
  let offset = archive.readUInt32LE(end + 16), total = 0;
  const entries: ArchiveEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP dañado: entrada del directorio central inválida");
    const flags = archive.readUInt16LE(offset + 8), method = archive.readUInt16LE(offset + 10);
    const compressed = archive.readUInt32LE(offset + 20), size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28), extraLength = archive.readUInt16LE(offset + 30), commentLength = archive.readUInt16LE(offset + 32);
    const local = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/") || IGNORED.test(name)) continue;
    if (flags & 1) throw new Error(`ZIP cifrado no admitido: ${name}`);
    if (compressed === 0xffffffff || size === 0xffffffff) throw new Error("ZIP64 no admitido");
    assertSafeRelativePath(name, "archivo del ZIP");
    total += size;
    if (total > maxBytes) throw new Error(`El contenido descomprimido supera ${Math.round(maxBytes / 1024 / 1024)} MiB`);
    if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error(`ZIP dañado: cabecera local inválida en ${name}`);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + compressed);
    let bytes: Buffer;
    if (method === 0) bytes = Buffer.from(data);
    else if (method === 8) bytes = inflateRawSync(data, { maxOutputLength: size + 1 });
    else throw new Error(`Método de compresión no admitido (${method}) en ${name}`);
    if (bytes.length !== size) throw new Error(`ZIP dañado: tamaño inesperado en ${name}`);
    entries.push({ path: name, bytes });
  }
  return entries.sort(byPath);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Deflated ZIP with a fixed timestamp, so the same files always produce the same bytes. */
export function writeZip(entries: ArchiveEntry[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of [...entries].sort(byPath)) {
    const name = Buffer.from(entry.path, "utf8"), data = deflateRawSync(entry.bytes), crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(entry.bytes.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function toArtifactFiles(entries: ArchiveEntry[]): ArtifactFile[] {
  return entries.map(entry => ({ path: entry.path, content: entry.bytes.toString("base64"), sha256: sha256(entry.bytes) }));
}

/** If every entry shares one top folder ("my-skill/..."), returns it and the entries without it. */
export function stripSingleRoot(entries: ArchiveEntry[]): { root?: string; entries: ArchiveEntry[] } {
  const roots = new Set(entries.map(entry => entry.path.split("/")[0]));
  if (roots.size !== 1 || entries.some(entry => !entry.path.includes("/"))) return { entries };
  const root = [...roots][0]!;
  return { root, entries: entries.map(entry => ({ path: entry.path.slice(root.length + 1), bytes: entry.bytes })) };
}

function frontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try { return (YAML.parse(match[1]!) as Record<string, unknown>) ?? {}; } catch { return {}; }
}

const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

export interface SkillImportOptions { namespace: string; version?: string; name?: string }

/**
 * Converts a `.skill` file (a ZIP whose root holds SKILL.md, usually inside one folder named after the skill)
 * into a modai.dev/v1 package that contributes that skill. Name and description come from SKILL.md's frontmatter.
 */
export function skillArchiveToPackage(archive: Buffer, options: SkillImportOptions): PublishPackageInput & { skill: { name: string; description: string } } {
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(options.namespace)) throw new Error("El namespace empieza con @ y usa minúsculas (por ejemplo @skills)");
  const { root, entries } = stripSingleRoot(readZip(archive));
  const skillFile = entries.find(entry => entry.path === "SKILL.md");
  if (!skillFile) throw new Error("El .skill no contiene SKILL.md en su raíz");
  const meta = frontmatter(skillFile.bytes.toString("utf8"));
  const name = slug(options.name || String(meta.name ?? "") || root || "");
  if (!name) throw new Error("No se pudo deducir el nombre de la skill: añade `name:` al frontmatter de SKILL.md");
  const description = String(meta.description ?? "").trim() || skillFile.bytes.toString("utf8").replace(/^---[\s\S]*?---/, "").match(/^#\s+(.+)$/m)?.[1]?.trim() || `Skill ${name}`;
  const version = options.version ?? (typeof meta.version === "string" || typeof meta.version === "number" ? String(meta.version) : "1.0.0");
  const base = `skills/${name}`;
  const files = toArtifactFiles(entries.map(entry => ({ path: `${base}/${entry.path}`, bytes: entry.bytes })));
  return {
    manifest: {
      apiVersion: "modai.dev/v1", kind: "Package",
      metadata: { name: `${options.namespace}/${name}`, version, description: description.slice(0, 5000), keywords: ["skill"] },
      spec: { category: "skill", contributes: { skills: [{ name, path: base }] } },
    } as unknown as PublishPackageInput["manifest"],
    files,
    skill: { name, description },
  };
}

/** Never part of a template: dependencies, build output, VCS data and local secrets (`.env.example` stays). */
export const TEMPLATE_EXCLUDED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.turbo|\.modai\/store|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/;

export interface TemplateImportOptions {
  name: string; version: string; description: string; category?: string; keywords?: string[]; license?: string;
  /** When given, replaces the template's modai.template.yaml (an empty map and no add-on removes it). */
  declaration?: { features?: Record<string, Record<string, unknown>>; addon?: { for: string[] } };
}

/**
 * A project template as a `kind: Template` package: the files of a whole starter project, from a ZIP or a file list.
 * A ZIP that wraps everything in one folder loses that folder; dependencies, build output and secrets are left out.
 */
export function templateToPackage(source: { archive?: Buffer; entries?: ArchiveEntry[] }, options: TemplateImportOptions): PublishPackageInput {
  let entries = source.archive ? stripSingleRoot(readZip(source.archive)).entries : (source.entries ?? []);
  entries = entries.map(entry => ({ path: entry.path.replaceAll("\\", "/"), bytes: entry.bytes })).filter(entry => !TEMPLATE_EXCLUDED.test(entry.path)).sort(byPath);
  if (options.declaration) {
    entries = entries.filter(entry => entry.path !== TEMPLATE_MANIFEST);
    const { features = {}, addon } = options.declaration;
    if (Object.keys(features).length || addon) entries.push({ path: TEMPLATE_MANIFEST, bytes: Buffer.from(YAML.stringify({ ...(Object.keys(features).length ? { features } : {}), ...(addon ? { addon } : {}) }), "utf8") });
    entries.sort(byPath);
  }
  if (!entries.length) throw new Error("El template no tiene archivos (se excluyen node_modules, .git, dist y .env)");
  const keywords = [...new Set((options.keywords ?? []).map(word => String(word).trim().toLowerCase().slice(0, 64)).filter(Boolean))].slice(0, 50);
  return {
    manifest: {
      apiVersion: "modai.dev/v1", kind: "Template",
      metadata: { name: options.name, version: options.version, description: options.description.trim().slice(0, 5000), ...(keywords.length ? { keywords } : {}), ...(options.license ? { license: options.license } : {}) },
      spec: { category: options.category || "template" },
    } as unknown as PublishPackageInput["manifest"],
    files: toArtifactFiles(entries),
  };
}
