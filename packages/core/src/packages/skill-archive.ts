import type { PublishPackageInput } from "@modai/contracts/types";
import YAML from "yaml";
import { stripSingleRoot, toArtifactFiles } from "./archive-entries.js";
import { readZip } from "./zip.js";

function frontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    return (YAML.parse(match[1]!) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

function skillDescription(meta: Record<string, unknown>, markdown: string, name: string): string {
  const declared = String(meta.description ?? "").trim();
  if (declared) return declared;
  const heading = markdown
    .replace(/^---[\s\S]*?---/, "")
    .match(/^#\s+(.+)$/m)?.[1]
    ?.trim();
  return heading || `Skill ${name}`;
}

function metadataVersion(meta: Record<string, unknown>): string {
  return typeof meta.version === "string" || typeof meta.version === "number" ? String(meta.version) : "1.0.0";
}

export interface SkillImportOptions {
  namespace: string;
  version?: string;
  name?: string;
}

export function skillArchiveToPackage(
  archive: Buffer,
  options: SkillImportOptions,
): PublishPackageInput & { skill: { name: string; description: string } } {
  if (!/^@[a-z0-9][a-z0-9._-]*$/.test(options.namespace))
    throw new Error("El namespace empieza con @ y usa minúsculas (por ejemplo @skills)");
  const { root, entries } = stripSingleRoot(readZip(archive));
  const skillFile = entries.find((entry) => entry.path === "SKILL.md");
  if (!skillFile) throw new Error("El .skill no contiene SKILL.md en su raíz");
  const meta = frontmatter(skillFile.bytes.toString("utf8"));
  const name = slug(options.name || String(meta.name ?? "") || root || "");
  if (!name) throw new Error("No se pudo deducir el nombre de la skill: añade `name:` al frontmatter de SKILL.md");
  const description = skillDescription(meta, skillFile.bytes.toString("utf8"), name);
  const version = options.version ?? metadataVersion(meta);
  const base = `skills/${name}`;
  const files = toArtifactFiles(entries.map((entry) => ({ path: `${base}/${entry.path}`, bytes: entry.bytes })));
  return {
    manifest: {
      apiVersion: "modai.dev/v1",
      kind: "Package",
      metadata: {
        name: `${options.namespace}/${name}`,
        version,
        description: description.slice(0, 5000),
        keywords: ["skill"],
      },
      spec: { category: "skill", contributes: { skills: [{ name, path: base }] } },
    } as unknown as PublishPackageInput["manifest"],
    files,
    skill: { name, description },
  };
}
