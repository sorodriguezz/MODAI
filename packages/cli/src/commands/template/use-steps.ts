import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertSafeRelativePath } from "@modai/contracts/security";
import {
  baseFiles,
  type composeTemplate,
  requiredAddons,
  safeProjectPath,
  type TemplateFile,
  type TemplateManifest,
} from "@modai/core";
import type { ApiClient } from "@modai/sdk";
import { splitVersionSpec } from "../../services/package-spec.js";
import { applyVariables, GENERAL_FLAGS, manifestOf, TEXT_FILE, verifiedTemplate } from "../../services/templates.js";
import type { InstallationPolicy } from "../../services/trust.js";
import { askCheckbox, interactive } from "../../terminal/prompts.js";

export type Composed = ReturnType<typeof composeTemplate>;
export type PlannedFile = { relative: string; content: string };

export function splitArgs(args: string[]): { operands: string[]; flags: string[] } {
  const operands: string[] = [],
    flags: string[] = [];
  for (const token of args) (token.startsWith("-") ? flags : operands).push(token);
  return { operands, flags };
}

export async function askFeatures(manifest: TemplateManifest, name: string, flags: string[]): Promise<void> {
  if (
    flags.some((flag) => flag.startsWith("--") && !GENERAL_FLAGS.has(flag.split("=")[0]!)) ||
    !manifest.features.length ||
    !interactive()
  )
    return;
  const on = await askCheckbox({
    message: `Opciones de ${name}`,
    flag: "--<feature>",
    choices: manifest.features.map((feature) => ({
      value: feature.name,
      name: `--${feature.name}`,
      description: feature.description,
      checked: feature.default,
    })),
  });
  flags.push(
    ...manifest.features
      .filter((feature) => on.includes(feature.name) !== feature.default)
      .map((feature) => (on.includes(feature.name) ? `--${feature.name}` : `--no-${feature.name}`)),
  );
}

export async function loadAddons(
  api: ApiClient,
  trust: InstallationPolicy,
  templateName: string,
  wanted: string[],
): Promise<Map<string, TemplateFile[]>> {
  const addons = new Map<string, TemplateFile[]>();
  for (const addonSpec of new Set(wanted)) {
    const addonRef = splitVersionSpec(addonSpec);
    const loaded = await verifiedTemplate(api, addonRef.name, addonRef.version, trust);
    const addonManifest = manifestOf(loaded.files);
    if (addonManifest.addon?.for.length && !addonManifest.addon.for.includes(templateName))
      throw new Error(
        `${addonSpec} no está pensado para ${templateName}: solo para ${addonManifest.addon.for.join(", ")}`,
      );
    addons.set(addonSpec, baseFiles(loaded.files, addonManifest));
  }
  return addons;
}

export function wantedAddons(manifest: TemplateManifest, selected: string[], extra: string[]): string[] {
  return [...requiredAddons(manifest, selected), ...extra];
}

export function planFiles(composed: Composed, variables: Record<string, string>): PlannedFile[] {
  return composed.files.map((file) => {
    const relative = applyVariables(file.path, variables);
    assertSafeRelativePath(relative, "path");
    return { relative, content: file.content };
  });
}

export function writeFiles(target: string, planned: PlannedFile[], variables: Record<string, string>): void {
  mkdirSync(target, { recursive: true });
  for (const file of planned) {
    const destination = safeProjectPath(target, file.relative);
    mkdirSync(dirname(destination), { recursive: true });
    const bytes = Buffer.from(file.content, "base64");
    writeFileSync(
      destination,
      TEXT_FILE.test(file.relative) ? applyVariables(bytes.toString("utf8"), variables) : bytes,
    );
  }
}

export function summaryText(selected: string[], wanted: string[], packages: string[]): string {
  return [
    selected.length ? `features: ${selected.join(", ")}` : "",
    wanted.length ? `add-ons: ${[...new Set(wanted)].join(", ")}` : "",
    packages.length ? `paquetes: ${packages.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function dryRunText(
  target: string,
  record: { name: string; version: string },
  planned: PlannedFile[],
  composed: Composed,
  summary: string,
): string {
  const packages = Object.keys(composed.packages);
  const packageText = packages
    .map((name) => {
      const item = composed.packages[name]!;
      const flags = item.features.length ? ` (${item.features.map((feature) => `--${feature}`).join(" ")})` : "";
      return `${name}@${item.version}${flags}`;
    })
    .join(", ");
  return `Se crearían ${planned.length} archivos en ${target} desde ${record.name}@${record.version}${summary ? ` (${summary})` : ""}:\n${planned.map((file) => `  ${file.relative}`).join("\n")}${packages.length ? `\nmodai.yaml: ${packageText}` : ""}`;
}

export function createdText(
  target: string,
  record: { name: string; version: string },
  planned: PlannedFile[],
  composed: Composed,
  summary: string,
): string {
  const overwritten = composed.overwritten;
  const layers = overwritten.length
    ? `\n${overwritten.length} archivo(s) del template base fueron reemplazados por una capa: ${overwritten.slice(0, 5).join(", ")}${overwritten.length > 5 ? "…" : ""}`
    : "";
  return `Proyecto creado en ${target} desde ${record.name}@${record.version} (${planned.length} archivos${summary ? `; ${summary}` : ""}).${layers}`;
}
