import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, posix, resolve } from "node:path";
import YAML from "yaml";
import { assertSafeRelativePath, sha256 } from "@modai/contracts/security";
import { isV1Manifest, type ArtifactFile, type PublishPackageInput } from "@modai/contracts/types";
import { safeProjectPath } from "./fs.js";

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const IGNORED = new Set([".DS_Store", "Thumbs.db", ".git", "node_modules"]);

function listFiles(root: string, relative: string): string[] {
  assertSafeRelativePath(relative, "path");
  const absolute = safeProjectPath(root, relative, false, true);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos en paquetes: ${relative}`);
  if (info.isFile()) return [relative.replaceAll("\\", "/")];
  if (!info.isDirectory()) return [];
  return readdirSync(absolute).filter(name => !IGNORED.has(name)).sort()
    .flatMap(name => listFiles(root, posix.join(relative.replaceAll("\\", "/"), name)));
}

function firstHeading(content: string, fallback: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 300) || fallback;
}

type RawV1 = { spec?: { entrypoints?: { skills?: string; knowledge?: string; rules?: string }; contributes?: Record<string, unknown[]>; include?: string[] } };

/** Expands `spec.entrypoints` directory conventions into explicit `spec.contributes` entries. */
function expandEntrypoints(root: string, manifest: RawV1): void {
  const spec = manifest.spec ?? {};
  const entrypoints = spec.entrypoints;
  if (!entrypoints) return;
  const contributes = (spec.contributes ??= {});
  const named = (key: string) => new Set((contributes[key] as Array<{ name?: string; path?: string }> | undefined ?? []).map(item => item.name ?? item.path));
  if (entrypoints.skills && existsSync(safeProjectPath(root, entrypoints.skills, false, true))) {
    const known = named("skills");
    for (const name of readdirSync(safeProjectPath(root, entrypoints.skills, false, true)).sort()) {
      const path = posix.join(entrypoints.skills, name);
      if (!known.has(name) && existsSync(join(safeProjectPath(root, path, false, true), "SKILL.md"))) (contributes.skills ??= []).push({ name, path });
    }
  }
  if (entrypoints.knowledge && existsSync(safeProjectPath(root, entrypoints.knowledge, false, true))) {
    const known = named("knowledge");
    for (const path of listFiles(root, entrypoints.knowledge).filter(file => /\.(md|txt)$/i.test(file))) {
      if (!known.has(path)) (contributes.knowledge ??= []).push({ path, title: firstHeading(readFileSync(safeProjectPath(root, path), "utf8"), basename(path)), tags: [] });
    }
  }
  if (entrypoints.rules && existsSync(safeProjectPath(root, entrypoints.rules, false, true))) {
    const known = named("rules");
    for (const path of listFiles(root, entrypoints.rules).filter(file => /\.md$/i.test(file))) {
      const name = basename(path).replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (!known.has(name)) (contributes.rules ??= []).push({ name, path });
    }
  }
  delete spec.entrypoints;
}

/** Reads a package directory (legacy or v1 manifest) and produces the immutable artifact to publish. */
export function loadPackageSource(directory: string): PublishPackageInput {
  const root = resolve(directory);
  const manifestPath = safeProjectPath(root, "modai.package.yaml");
  if (!existsSync(manifestPath)) throw new Error(`Falta ${manifestPath}`);
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8"));
  const sources = new Set<string>();
  if (isV1Manifest(manifest)) {
    expandEntrypoints(root, manifest as RawV1);
    const spec = (manifest as RawV1).spec ?? {};
    const contributes = (spec.contributes ?? {}) as Record<string, Array<Record<string, unknown>>>;
    for (const skill of contributes.skills ?? []) {
      const path = String(skill.path);
      const files = skill.files as string[] | undefined;
      for (const file of files ? files.map(item => posix.join(path, item)) : listFiles(root, path)) sources.add(file);
    }
    for (const key of ["rules", "knowledge"]) for (const item of contributes[key] ?? []) sources.add(String(item.path));
    for (const item of contributes.files ?? []) sources.add(String(item.source));
    for (const path of spec.include ?? []) for (const file of listFiles(root, path)) sources.add(file);
  } else {
    for (const rule of manifest?.files ?? []) sources.add(rule.source);
    for (const rule of manifest?.knowledge ?? []) sources.add(rule.source);
  }
  const files: ArtifactFile[] = [];
  let totalBytes = 0;
  for (const source of [...sources].sort()) {
    assertSafeRelativePath(source, "source");
    const path = safeProjectPath(root, source);
    if (!existsSync(path)) throw new Error(`No existe ${path}`);
    const content = readFileSync(path);
    totalBytes += content.byteLength;
    if (totalBytes > MAX_PACKAGE_BYTES) throw new Error("El paquete supera 25 MiB");
    files.push({ path: posix.normalize(source.replaceAll("\\", "/")), content: content.toString("base64"), sha256: sha256(content) });
  }
  return { manifest, files };
}
