import type { PublishPackageInput } from "@modai/contracts/types";
import YAML from "yaml";
import { stripSingleRoot, toArtifactFiles } from "../packages/archive-entries.js";
import { type ArchiveEntry, compareArchivePaths, readZip } from "../packages/zip.js";
import { TEMPLATE_MANIFEST } from "./template-types.js";

export const TEMPLATE_EXCLUDED =
  /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.turbo|\.modai\/store|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/;

export interface TemplateImportOptions {
  name: string;
  version: string;
  description: string;
  category?: string;
  keywords?: string[];
  license?: string;
  declaration?: { features?: Record<string, Record<string, unknown>>; addon?: { for: string[] } };
}

function withDeclaration(
  entries: ArchiveEntry[],
  declaration: NonNullable<TemplateImportOptions["declaration"]>,
): ArchiveEntry[] {
  const result = entries.filter((entry) => entry.path !== TEMPLATE_MANIFEST);
  const { features = {}, addon } = declaration;
  const hasFeatures = Object.keys(features).length > 0;
  if (hasFeatures || addon)
    result.push({
      path: TEMPLATE_MANIFEST,
      bytes: Buffer.from(YAML.stringify({ ...(hasFeatures ? { features } : {}), ...(addon ? { addon } : {}) }), "utf8"),
    });
  return result.sort(compareArchivePaths);
}

function normalizedKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((word) => String(word).trim().toLowerCase().slice(0, 64)).filter(Boolean))].slice(
    0,
    50,
  );
}

export function templateToPackage(
  source: { archive?: Buffer; entries?: ArchiveEntry[] },
  options: TemplateImportOptions,
): PublishPackageInput {
  let entries = source.archive ? stripSingleRoot(readZip(source.archive)).entries : (source.entries ?? []);
  entries = entries
    .map((entry) => ({ path: entry.path.replaceAll("\\", "/"), bytes: entry.bytes }))
    .filter((entry) => !TEMPLATE_EXCLUDED.test(entry.path))
    .sort(compareArchivePaths);
  if (options.declaration) entries = withDeclaration(entries, options.declaration);
  if (!entries.length) throw new Error("El template no tiene archivos (se excluyen node_modules, .git, dist y .env)");
  const keywords = normalizedKeywords(options.keywords ?? []);
  return {
    manifest: {
      apiVersion: "modai.dev/v1",
      kind: "Template",
      metadata: {
        name: options.name,
        version: options.version,
        description: options.description.trim().slice(0, 5000),
        ...(keywords.length ? { keywords } : {}),
        ...(options.license ? { license: options.license } : {}),
      },
      spec: { category: options.category || "template" },
    } as unknown as PublishPackageInput["manifest"],
    files: toArtifactFiles(entries),
  };
}
