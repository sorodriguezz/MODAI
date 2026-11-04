import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { sha256 } from "@modai/contracts/security";
import type { ArtifactFile } from "@modai/contracts/types";
import {
  createProjectFile,
  isV1Project,
  loadV1Project,
  parseFeatureFlags,
  parseTemplateManifest,
  saveProjectFile,
  suggestFeature,
  TEMPLATE_EXCLUDED,
  TEMPLATE_MANIFEST,
  type TemplateManifest,
  type TemplatePackage,
} from "@modai/core";
import type { ApiClient } from "@modai/sdk";
import { type InstallationPolicy, verifyPackage } from "./trust.js";

export const TEXT_FILE =
  /\.(md|mdx|txt|json|jsonc|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|css|scss|html|xml|sh|ps1|py|java|kt|go|rs|env\.example|gitignore|dockerignore|editorconfig|properties|gradle|sql|graphql|prisma|vue|svelte)$|(^|\/)(Dockerfile|Makefile|README|LICENSE|\.gitignore|\.npmrc|\.nvmrc)$/i;

export const GENERAL_FLAGS = new Set(["--var", "--with", "--force", "--dry-run", "--sync", "--allow", "--help"]);

export async function verifiedTemplate(
  api: ApiClient,
  name: string,
  version: string | undefined,
  trust: InstallationPolicy,
) {
  const loaded = await api.templateFiles(name, version);
  verifyPackage(loaded.template, loaded, trust.policy, trust.trustedPublishers);
  return loaded;
}

export function collectTemplateFiles(root: string, relative = ""): ArtifactFile[] {
  const absolute = relative ? join(root, relative) : root;
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || (relative && TEMPLATE_EXCLUDED.test(relative))) return [];
  if (info.isFile()) {
    const bytes = readFileSync(absolute);
    return [{ path: relative, content: bytes.toString("base64"), sha256: sha256(bytes) }];
  }
  if (!info.isDirectory()) return [];
  return readdirSync(absolute)
    .sort()
    .flatMap((name) => collectTemplateFiles(root, relative ? posix.join(relative, name) : name));
}

export function applyVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
}

export function manifestOf(files: ArtifactFile[]): TemplateManifest {
  const file = files.find((item) => item.path === TEMPLATE_MANIFEST);
  return file ? parseTemplateManifest(Buffer.from(file.content, "base64").toString("utf8")) : { features: [] };
}

export function templateChoice(
  flags: string[],
  manifest: TemplateManifest,
  templateName: string,
): Record<string, boolean> {
  const names = manifest.features.map((feature) => feature.name);
  const { choice, unknown } = parseFeatureFlags(flags, names);
  if (unknown.length) {
    const hint = suggestFeature(unknown[0]!, names);
    throw new Error(
      `${templateName} no tiene la opción ${unknown[0]}.${hint ? ` ¿Quisiste decir --${hint}?` : ""}${names.length ? ` Features: ${names.map((name) => `--${name}`).join(", ")}.` : " Este template no declara features."} Ver: modai template use ${templateName} --help`,
    );
  }
  return choice;
}

export function addTemplatePackages(target: string, packages: Record<string, TemplatePackage>, server: string): void {
  const file = isV1Project(target)
    ? loadV1Project(target).file
    : createProjectFile(basename(target), { registries: [{ name: "central", url: server }] });
  for (const [name, spec] of Object.entries(packages)) {
    if (!(name in file.dependencies)) file.dependencies[name] = spec.version;
    if (spec.features.length)
      file.features[name] = {
        ...(file.features[name] ?? {}),
        ...Object.fromEntries(spec.features.map((feature) => [feature, true])),
      };
  }
  saveProjectFile(target, file);
}

export function templateVariables(pairs: string[], base: Record<string, string>): Record<string, string> {
  const variables = { ...base };
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index < 1) throw new Error(`Variable inválida: ${pair}. Usa clave=valor.`);
    variables[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return variables;
}
