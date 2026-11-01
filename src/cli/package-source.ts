import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import YAML from "yaml";
import { assertSafeRelativePath, sha256 } from "../core/security.js";
import type { ArtifactFile, PackageManifest, PublishPackageInput } from "../core/types.js";

export function loadPackageSource(directory: string): PublishPackageInput {
  const root = resolve(directory);
  const manifestPath = join(root, "modai.package.yaml");
  if (!existsSync(manifestPath)) throw new Error(`Falta ${manifestPath}`);
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  const sources = new Set([
    ...(manifest.files ?? []).map((rule) => rule.source),
    ...(manifest.knowledge ?? []).map((rule) => rule.source),
  ]);
  const files: ArtifactFile[] = [];
  for (const source of sources) {
    assertSafeRelativePath(source, "source");
    const path = resolve(root, source);
    const relation = relative(root, path);
    if (relation.startsWith("..") || isAbsolute(relation)) throw new Error(`Fuente fuera del paquete: ${source}`);
    if (!existsSync(path)) throw new Error(`No existe ${path}`);
    const content = readFileSync(path);
    files.push({ path: source.replaceAll("\\", "/"), content: content.toString("base64"), sha256: sha256(content) });
  }
  return { manifest, files };
}
