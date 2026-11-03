import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import YAML from "yaml";
import type { Command } from "commander";
import semver from "semver";
import type { PackageManifestV1 } from "@modai/contracts/spec-v1";
import {
  HttpRegistry, TEMPLATE_MANIFEST, featureHelpLines, parseTemplateManifest, validateTemplateManifest, isV1Project, loadPackageSource, loadV1Project, normalizeManifest, readStoreRecord, packageFeatureRules, parseFeatureFlags,
  selectPackageFeatures, suggestFeature, type Registry,
} from "@modai/core";
import { effectiveConnection } from "../cli/connection.js";
import { group } from "../cli/groups.js";
import type { Print } from "../cli/output.js";
import { parseSpec } from "./commands.js";
import { askText } from "../cli/ui.js";
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

  // Authoring: the options a package or a template offers, without editing YAML by hand.
  const listOption = (value: string, previous: string[] = []) => [...previous, ...value.split(",").map(item => item.trim()).filter(Boolean)];
  const repeatable = (value: string, previous: string[] = []) => [...previous, value];
  feature.command("define").description("Crea o reemplaza una feature en la carpeta de un paquete (modai.package.yaml) o de un template (modai.template.yaml)")
    .argument("<directory>", "Carpeta del paquete o del template")
    .argument("<name>", "Nombre de la feature: se activa con --<nombre>")
    .option("--description <text>", "Qué hace (lo que se ve en --help); sin ella, se pregunta")
    .option("--path <folder>", "Carpeta con sus archivos: en un template se copian sobre el proyecto; en un paquete se añaden al componente")
    .option("--component <name>", "Paquete con varios componentes: a cuál se añaden los archivos de --path")
    .option("--default", "Activada salvo --no-<nombre>")
    .option("--requires <features>", "Features que activa también (separadas por comas)", listOption)
    .option("--conflicts <features>", "Features con las que no se combina (separadas por comas)", listOption)
    .option("--package <@scope/nombre@rango>", "Paquete que añade mientras está activa (repetible)", repeatable)
    .option("--var <clave=valor>", "Solo templates: valor de un marcador {{clave}} (repetible)", repeatable)
    .option("--uses <@scope/nombre[@versión]>", "Solo templates: add-on que se aplica antes de la carpeta")
    .action(async (directory: string, name: string, options: { description?: string; path?: string; component?: string; default?: boolean; requires?: string[]; conflicts?: string[]; package?: string[]; var?: string[]; uses?: string }) => {
      const root = resolve(directory);
      options.description ??= await askText({ message: `¿Qué hace --${name}?`, flag: "--description", example: "Añade Spec-Driven Development (specs/ y plantillas)" });
      const packages = Object.fromEntries((options.package ?? []).map(spec => { const parsed = parseSpec(spec, root); return [parsed.name, parsed.value || "*"]; }));
      const isPackage = existsSync(join(root, "modai.package.yaml"));
      if (isPackage && (options.var?.length || options.uses)) throw new Error("--var y --uses solo existen en templates");
      const file = join(root, isPackage ? "modai.package.yaml" : TEMPLATE_MANIFEST);
      // An empty or missing file still needs a map at the top for setIn.
      const text = existsSync(file) ? readFileSync(file, "utf8") : "";
      const document = YAML.parseDocument(text.trim() && YAML.parse(text) ? text : `${text}${text && !text.endsWith("\n") ? "\n" : ""}{}\n`);
      if (isPackage) {
        const components = (document.getIn(["spec", "contributes", "components"]) as YAML.YAMLSeq | undefined)?.toJSON() as Array<{ name: string }> | undefined;
        const component = options.component ?? components?.[0]?.name;
        if (options.path && !component) throw new Error("--path añade archivos a un componente y este paquete no declara ninguno (spec.contributes.components)");
        document.setIn(["spec", "features", name], {
          description: options.description!, ...(options.default ? { default: true } : {}),
          ...(options.requires?.length ? { requires: options.requires } : {}), ...(options.conflicts?.length ? { conflicts: options.conflicts } : {}),
          ...(Object.keys(packages).length ? { dependencies: packages } : {}), ...(options.path ? { overlays: [{ component, path: options.path }] } : {}),
        });
      } else {
        const vars = Object.fromEntries((options.var ?? []).map(pair => { const index = pair.indexOf("="); if (index < 1) throw new Error(`Variable inválida: ${pair}. Usa clave=valor.`); return [pair.slice(0, index), pair.slice(index + 1)]; }));
        document.setIn(["features", name], {
          description: options.description, ...(options.path ? { path: options.path } : {}), ...(options.default ? { default: true } : {}),
          ...(options.requires?.length ? { requires: options.requires } : {}), ...(options.conflicts?.length ? { conflicts: options.conflicts } : {}),
          ...(options.uses ? { uses: options.uses } : {}), ...(Object.keys(vars).length ? { vars } : {}), ...(Object.keys(packages).length ? { packages } : {}),
        });
        // Same checks as the server on publish: folders exist, requires/conflicts make sense.
        validateTemplateManifest(parseTemplateManifest(document.toString()), filesUnder(root));
      }
      // Block style ("features: {}" from template init, or "{}" for an empty file, would otherwise stay inline).
      YAML.visit(document, { Map: (_key, node) => { node.flow = false; }, Seq: (_key, node) => { node.flow = false; } });
      if (isPackage) normalizeManifest(YAML.parse(document.toString()));
      writeFileSync(file, document.toString(), "utf8");
      print(`Feature --${name} definida en ${file}.${isPackage ? `\nValida el paquete: modai package validate ${directory}` : `\nPruébala: modai template use <template> --${name} --dry-run (tras publicar)`}`);
    });
  feature.command("undefine").description("Quita una feature de la carpeta de un paquete o de un template")
    .argument("<directory>", "Carpeta del paquete o del template").argument("<name>", "Nombre de la feature")
    .action((directory: string, name: string) => {
      const root = resolve(directory);
      const isPackage = existsSync(join(root, "modai.package.yaml"));
      const file = join(root, isPackage ? "modai.package.yaml" : TEMPLATE_MANIFEST);
      if (!existsSync(file)) throw new Error(`No existe ${file}`);
      const document = YAML.parseDocument(readFileSync(file, "utf8"));
      const path = isPackage ? ["spec", "features", name] : ["features", name];
      if (!document.hasIn(path)) throw new Error(`${file} no declara la feature ${name}`);
      document.deleteIn(path);
      writeFileSync(file, document.toString(), "utf8");
      print(`Feature --${name} quitada de ${file}. Revisa las que la requerían o se oponían a ella.`);
    });
}

/** Relative paths of every file under `root` (for checking a template's feature folders before publishing). */
function filesUnder(root: string, relative = ""): string[] {
  return readdirSync(join(root, relative)).flatMap(entry => {
    const path = relative ? posix.join(relative, entry) : entry;
    return statSync(join(root, path)).isDirectory() ? (/(^|\/)(node_modules|\.git)$/.test(path) ? [] : filesUnder(root, path)) : [path];
  });
}
