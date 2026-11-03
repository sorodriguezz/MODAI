import { resolve } from "node:path";
import type { Command } from "commander";
import semver from "semver";
import type { PackageManifestV1 } from "@modai/contracts/spec-v1";
import {
  HttpRegistry, featureHelpLines, isV1Project, loadPackageSource, loadV1Project, normalizeManifest, readStoreRecord, packageFeatureRules, parseFeatureFlags,
  selectPackageFeatures, suggestFeature, type Registry,
} from "@modai/core";
import { effectiveConnection } from "../cli/connection.js";
import { group } from "../cli/groups.js";
import type { Print } from "../cli/output.js";
import { parseSpec } from "./commands.js";
import { projectRegistry, requireV1Project, runSync, summarize, tokenFor } from "./runtime.js";

/**
 * Feature flags on the command line. `modai add @eq/health --tls @eq/auth --jwt --no-sessions` gives each flag to the
 * package written before it. Returns the packages in order with their choices.
 */
export function splitPackageFlags(tokens: string[]): Array<{ spec: string; flags: string[] }> {
  const groups: Array<{ spec: string; flags: string[] }> = [];
  for (const token of tokens) {
    if (token.startsWith("-")) {
      if (!groups.length) throw new Error(`${token} va después del paquete al que se aplica: modai add @scope/paquete ${token}`);
      groups.at(-1)!.flags.push(token);
    } else groups.push({ spec: token, flags: [] });
  }
  return groups;
}

/** Registry to look packages up: the project's, or the connected server when outside a project. */
function lookupRegistry(root: string): Registry {
  if (isV1Project(root)) return projectRegistry(loadV1Project(root));
  const { server } = effectiveConnection();
  return new HttpRegistry(server, tokenFor(server));
}

/** The manifest `modai add <spec>` would install (latest non-yanked version in range, or a local folder). */
export async function manifestForSpec(spec: string, root = process.cwd()): Promise<PackageManifestV1> {
  const parsed = parseSpec(spec, root);
  if (parsed.value.startsWith("file:")) return normalizeManifest(loadPackageSource(resolve(root, parsed.value.slice(5))).manifest);
  const range = parsed.value === "*" ? "*" : parsed.value;
  const versions = (await lookupRegistry(root).versions(parsed.name))
    .filter(item => item.status !== "yanked" && semver.valid(item.version) && (range === "*" || semver.satisfies(item.version, range)))
    .sort((a, b) => semver.rcompare(a.version, b.version));
  if (!versions.length) throw new Error(`No hay versión de ${parsed.name}${range === "*" ? "" : `@${range}`} en los registries`);
  return normalizeManifest(versions[0]!.manifest);
}

/** Checks flags against what the package declares, with a "did you mean" for typos. */
export function featureChoice(manifest: PackageManifestV1, flags: string[]): Record<string, boolean> {
  const names = packageFeatureRules(manifest).map(rule => rule.name);
  const { choice, unknown } = parseFeatureFlags(flags, names);
  if (unknown.length) {
    const hint = suggestFeature(unknown[0]!, names);
    throw new Error(`${manifest.metadata.name} no tiene la opción ${unknown[0]}.${hint ? ` ¿Quisiste decir --${hint}?` : ""}${names.length ? ` Features: ${names.map(name => `--${name}`).join(", ")}.` : " Este paquete no declara features."} Ver: modai add ${manifest.metadata.name} --help`);
  }
  return choice;
}

/** What `modai add <package> --help` prints: the package and the options it declares. `active` marks installed ones. */
export function packageHelp(manifest: PackageManifestV1, active?: string[]): string {
  const rules = packageFeatureRules(manifest).map(rule => {
    const feature = manifest.spec.features[rule.name]!;
    const labels: Record<string, string> = { skills: "skill(s)", rules: "regla(s)", knowledge: "documento(s)", tools: "herramienta(s)", mcpServers: "servidor(es) MCP", components: "componente(s)", files: "archivo(s)" };
    const adds = Object.entries(feature.contributes).filter(([, list]) => list.length).map(([key, list]) => `${list.length} ${labels[key] ?? key}`);
    const notes = [
      adds.length ? `añade ${adds.join(", ")}` : "",
      feature.overlays.length ? `modifica ${[...new Set(feature.overlays.map(overlay => overlay.component))].join(", ")}` : "",
      Object.keys(feature.dependencies).length ? `instala ${Object.keys(feature.dependencies).join(", ")}` : "",
    ].filter(Boolean);
    return { ...rule, notes };
  });
  const { name, version, description } = manifest.metadata;
  return [
    `${name}@${version}`, description, "",
    `Uso: modai add ${name} [opciones del paquete]`, "",
    rules.length ? `Opciones de este paquete:\n${featureHelpLines(rules, active).join("\n")}` : "Este paquete no declara features: se instala tal cual.",
    ...(rules.length ? ["", "--<feature> la activa y --no-<feature> quita una que viene activa. Cambiarlas después: modai feature enable|disable|reset."] : []),
  ].join("\n");
}

function installedManifest(root: string, name: string): { manifest: PackageManifestV1; active: string[] } {
  const project = loadV1Project(root);
  const locked = project.lock.packages[name];
  if (!locked) throw new Error(`${name} no está instalado en este proyecto. Instálalo con: modai add ${name}`);
  // The store keeps the published manifest, so its features are the declared ones.
  const record = readStoreRecord(project.root, name);
  if (!record) throw new Error(`Falta ${name} en .modai/store; ejecuta modai sync`);
  return { manifest: normalizeManifest(record.manifest), active: locked.features };
}

export function registerFeatureCommands(program: Command, print: Print): void {
  const feature = group(program, "feature", "Features de los paquetes instalados: partes opcionales que se activan o se quitan");

  feature.command("list", { isDefault: true }).alias("ls").description("Features de los paquetes del proyecto (o de un paquete, instalado o no)")
    .argument("[package]", "@scope/nombre[@rango]")
    .action(async (spec?: string) => {
      const root = process.cwd();
      if (spec && !(isV1Project(root) && loadV1Project(root).lock.packages[parseSpec(spec, root).name])) { print(packageHelp(await manifestForSpec(spec, root))); return; }
      const project = loadV1Project(requireV1Project());
      const names = spec ? [parseSpec(spec, root).name] : Object.keys(project.lock.packages);
      const rows = names.flatMap(name => {
        const { manifest, active } = installedManifest(project.root, name);
        return packageFeatureRules(manifest).map(rule => ({ package: name, feature: rule.name, active: active.includes(rule.name), default: rule.default, choice: project.file.features[name]?.[rule.name] === undefined ? "por defecto" : project.file.features[name]![rule.name] ? "activada" : "quitada", description: rule.description }));
      });
      print(rows.length ? rows : spec ? `${names[0]} no declara features.` : "Ningún paquete instalado declara features.");
    });

  const change = async (name: string, update: (choice: Record<string, boolean>, manifest: PackageManifestV1) => void, verb: string) => {
    const root = requireV1Project();
    const { manifest, active: before } = installedManifest(root, name);
    const { report } = await runSync(root, file => {
      const choice = { ...(file.features[name] ?? {}) };
      update(choice, manifest);
      file.features[name] = choice;
      selectPackageFeatures(manifest, choice); // fail early with a clear message (conflicts, required ones)
    });
    const after = report.lock.packages[name]?.features ?? [];
    print(`${verb} en ${name}. Features activas: ${after.join(", ") || "ninguna"}${before.join(",") !== after.join(",") ? ` (antes: ${before.join(", ") || "ninguna"})` : ""}.\n${summarize(report)}`);
  };
  const known = (manifest: PackageManifestV1, names: string[]) => {
    const declared = packageFeatureRules(manifest).map(rule => rule.name);
    for (const value of names) if (!declared.includes(value)) {
      const hint = suggestFeature(value, declared);
      throw new Error(`${manifest.metadata.name} no tiene la feature "${value}".${hint ? ` ¿Quisiste decir "${hint}"?` : ""} Disponibles: ${declared.join(", ") || "ninguna"}.`);
    }
  };
  feature.command("enable").alias("on").description("Activa features de un paquete instalado (y las que requieren)").argument("<package>").argument("<features...>")
    .action((name: string, names: string[]) => change(name, (choice, manifest) => { known(manifest, names); for (const value of names) choice[value] = true; }, `Activado ${names.join(", ")}`));
  feature.command("disable").alias("off").description("Quita features de un paquete instalado, incluidas las que vienen por defecto").argument("<package>").argument("<features...>")
    .action((name: string, names: string[]) => change(name, (choice, manifest) => { known(manifest, names); for (const value of names) choice[value] = false; }, `Quitado ${names.join(", ")}`));
  feature.command("reset").description("Vuelve a los valores por defecto del paquete (todas o las indicadas)").argument("<package>").argument("[features...]")
    .action((name: string, names: string[] = []) => change(name, (choice, manifest) => { known(manifest, names); for (const value of names.length ? names : Object.keys(choice)) delete choice[value]; }, names.length ? `Restablecido ${names.join(", ")}` : "Restablecidas las features"));
}
