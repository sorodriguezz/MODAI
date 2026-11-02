import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import YAML from "yaml";
import { safeProjectPath } from "./safe-path.js";
import { assertSafeRelativePath, sha256 } from "@modai/contracts/security";
import type { ArtifactFile, PackageManifest, PublishPackageInput } from "@modai/contracts/types";

export function loadPackageSource(directory: string): PublishPackageInput {
  const root = resolve(directory);
  const manifestPath = safeProjectPath(root, "modai.package.yaml");
  if (!existsSync(manifestPath)) throw new Error(`Falta ${manifestPath}`);
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  const sources = new Set([
    ...(manifest.files ?? []).map((rule) => rule.source),
    ...(manifest.knowledge ?? []).map((rule) => rule.source),
  ]);
  const files: ArtifactFile[] = [];
  let totalBytes = 0;
  for (const source of sources) {
    assertSafeRelativePath(source, "source");
    const path = safeProjectPath(root, source);
    const relation = relative(root, path);
    if (relation.startsWith("..") || isAbsolute(relation)) throw new Error(`Fuente fuera del paquete: ${source}`);
    if (!existsSync(path)) throw new Error(`No existe ${path}`);
    totalBytes += statSync(path).size;
    if (totalBytes > 25 * 1024 * 1024) throw new Error("El paquete supera 25 MiB");
    const content = readFileSync(path);
    files.push({ path: source.replaceAll("\\", "/"), content: content.toString("base64"), sha256: sha256(content) });
  }
  return { manifest, files };
}
