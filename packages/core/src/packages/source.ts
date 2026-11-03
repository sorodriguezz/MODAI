import { existsSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { API_VERSION } from "@modai/contracts/manifest";
import { assertSafeRelativePath, sha256 } from "@modai/contracts/security";
import type { ArtifactFile, PublishPackageInput } from "@modai/contracts/types";
import YAML from "yaml";
import { safeProjectPath } from "../installation/fs.js";
import { expandEntrypoints, type RawManifestV1 } from "./entrypoints.js";
import { listPackageFiles } from "./source-files.js";

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const PACKAGE_MANIFEST = "modai.package.yaml";

type RawContributes = Record<string, Array<Record<string, unknown>>>;
type RawFeature = { contributes?: RawContributes; overlays?: Array<{ path: string }> };

function addFolder(root: string, path: string, sources: Set<string>): void {
  for (const file of listPackageFiles(root, path)) if (file !== PACKAGE_MANIFEST) sources.add(file);
}

function collectContributionSources(root: string, contributes: RawContributes, sources: Set<string>): void {
  for (const skill of contributes.skills ?? []) {
    const path = String(skill.path);
    const files = skill.files as string[] | undefined;
    const list = files ? files.map((item) => posix.join(path, item)) : listPackageFiles(root, path);
    for (const file of list) sources.add(file);
  }
  for (const component of contributes.components ?? []) addFolder(root, String(component.path), sources);
  for (const key of ["rules", "knowledge"]) for (const item of contributes[key] ?? []) sources.add(String(item.path));
  for (const item of contributes.files ?? []) sources.add(String(item.source));
}

function collectSources(root: string, spec: NonNullable<RawManifestV1["spec"]>): Set<string> {
  const sources = new Set<string>();
  collectContributionSources(root, (spec.contributes ?? {}) as RawContributes, sources);
  for (const feature of Object.values((spec.features ?? {}) as Record<string, RawFeature>)) {
    collectContributionSources(root, feature?.contributes ?? {}, sources);
    for (const overlay of feature?.overlays ?? []) addFolder(root, String(overlay.path), sources);
  }
  for (const path of spec.include ?? []) for (const file of listPackageFiles(root, path)) sources.add(file);
  return sources;
}

function readSources(root: string, sources: Set<string>): ArtifactFile[] {
  const files: ArtifactFile[] = [];
  let totalBytes = 0;
  for (const source of [...sources].sort()) {
    assertSafeRelativePath(source, "source");
    const path = safeProjectPath(root, source);
    if (!existsSync(path)) throw new Error(`No existe ${path}`);
    const content = readFileSync(path);
    totalBytes += content.byteLength;
    if (totalBytes > MAX_PACKAGE_BYTES) throw new Error("El paquete supera 25 MiB");
    files.push({
      path: posix.normalize(source.replaceAll("\\", "/")),
      content: content.toString("base64"),
      sha256: sha256(content),
    });
  }
  return files;
}

export function loadPackageSource(directory: string): PublishPackageInput {
  const root = resolve(directory);
  const manifestPath = safeProjectPath(root, PACKAGE_MANIFEST);
  if (!existsSync(manifestPath)) throw new Error(`Falta ${manifestPath}`);
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.apiVersion !== API_VERSION)
    throw new Error(`${manifestPath} debe declarar apiVersion: ${API_VERSION} (ver docs/spec/PACKAGE-SPEC-v1.md).`);
  expandEntrypoints(root, manifest as RawManifestV1);
  const spec = (manifest as RawManifestV1).spec ?? {};
  return { manifest, files: readSources(root, collectSources(root, spec)) };
}
