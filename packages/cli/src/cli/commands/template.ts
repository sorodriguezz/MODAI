import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import type { Command } from "commander";
import { ApiClient } from "@modai/sdk";
import type { PackageRecord } from "@modai/contracts/types";
import { assertSafeRelativePath, sha256 } from "@modai/contracts/security";
import type { ArtifactFile } from "@modai/contracts/types";
import {
  baseFiles, composeTemplate, createProjectFile, featureHelpLines, isV1Project, loadV1Project, parseFeatureFlags, parseTemplateManifest, requiredAddons, safeProjectPath,
  saveProjectFile, selectFeatures, suggestFeature, TEMPLATE_EXCLUDED, TEMPLATE_MANIFEST, writeZip, type TemplateFile, type TemplateManifest, type TemplatePackage,
} from "@modai/core";
import { runSync, summarize } from "../../v1/runtime.js";
import { installationPolicy, verifyPackage } from "../../agent/trust.js";
import { askCheckbox, askSearch, askText, hint, interactive } from "../ui.js";
import { commaList } from "../agent-commands.js";
import { effectiveConnection } from "../connection.js";
import { group } from "../groups.js";
import type { Print } from "../output.js";

const serverApi = () => { const connection = effectiveConnection(); return new ApiClient(connection.server, connection.token); };

/**
 * A template's files, checked like an installed package before anything is written: file hashes, the artifact hash and
 * the signature under the strictest policy of this machine, the project and the server.
 */
async function verifiedTemplate(api: ApiClient, name: string, version: string | undefined, trust: Awaited<ReturnType<typeof installationPolicy>>) {
  const loaded = await api.templateFiles(name, version);
  verifyPackage(loaded.template, loaded, trust.policy, trust.trustedPublishers);
  return loaded;
}
const TEXT = /\.(md|mdx|txt|json|jsonc|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|css|scss|html|xml|sh|ps1|py|java|kt|go|rs|env\.example|gitignore|dockerignore|editorconfig|properties|gradle|sql|graphql|prisma|vue|svelte)$|(^|\/)(Dockerfile|Makefile|README|LICENSE|\.gitignore|\.npmrc|\.nvmrc)$/i;

function collect(root: string, relative = ""): ArtifactFile[] {
  const absolute = relative ? join(root, relative) : root;
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || (relative && TEMPLATE_EXCLUDED.test(relative))) return [];
  if (info.isFile()) { const bytes = readFileSync(absolute); return [{ path: relative, content: bytes.toString("base64"), sha256: sha256(bytes) }]; }
  if (!info.isDirectory()) return [];
  return readdirSync(absolute).sort().flatMap(name => collect(root, relative ? posix.join(relative, name) : name));
}

function splitSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  return at > spec.indexOf("/") ? { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined } : { name: spec };
}

/** `{{name}}` placeholders in paths and text files. Unknown placeholders are left untouched. */
export function applyVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
}

function manifestOf(files: ArtifactFile[]): TemplateManifest {
  const file = files.find(item => item.path === TEMPLATE_MANIFEST);
  return file ? parseTemplateManifest(Buffer.from(file.content, "base64").toString("utf8")) : { features: [] };
}

/** Feature flags of `template use`: unknown ones fail with what the template offers and a "did you mean". */
function templateChoice(flags: string[], manifest: TemplateManifest, templateName: string): Record<string, boolean> {
  const names = manifest.features.map(feature => feature.name);
  const { choice, unknown } = parseFeatureFlags(flags, names);
  if (unknown.length) {
    const hint = suggestFeature(unknown[0]!, names);
    throw new Error(`${templateName} no tiene la opción ${unknown[0]}.${hint ? ` ¿Quisiste decir --${hint}?` : ""}${names.length ? ` Features: ${names.map(name => `--${name}`).join(", ")}.` : " Este template no declara features."} Ver: modai template use ${templateName} --help`);
  }
  return choice;
}

function templateHelp(record: PackageRecord, manifest: TemplateManifest): string {
  const features = manifest.features.map(feature => ({ ...feature, notes: [feature.uses ? `usa ${feature.uses}` : "", Object.keys(feature.packages).length ? `instala ${Object.keys(feature.packages).join(", ")}` : ""].filter(Boolean) }));
  return [
    `${record.name}@${record.version} · ${record.manifest.spec?.category ?? "template"}`, record.description, "",
    `Uso: modai template use ${record.name} [carpeta] [opciones]`, "",
    features.length ? `Opciones de este template:\n${featureHelpLines(features).join("\n")}` : "Este template no declara features: se crea tal cual.",
    ...(manifest.addon ? ["", `Es un add-on${manifest.addon.for.length ? ` para ${manifest.addon.for.join(", ")}` : ""}: se combina con otro template usando --with ${record.name}.`] : []), "",
    "Opciones generales:",
    "  --var clave=valor   Valor para un marcador {{clave}}",
    "  --with <add-on>     Añade otro template como capa (repetible)",
    "  --sync              Instala ya los paquetes MODAI que aportan las features (modai sync)",
    "  --allow <permisos>  Permisos de instalación para --sync (por ejemplo project.source)",
    "  --dry-run           Muestra los archivos sin escribir",
    "  --force             Escribe aunque la carpeta no esté vacía",
    "  -h, --help          Esta ayuda",
  ].join("\n");
}

/** Adds the MODAI packages of the chosen features to the new project's modai.yaml (creating it when the template has none). */
function addTemplatePackages(target: string, packages: Record<string, TemplatePackage>, server: string): void {
  const file = isV1Project(target) ? loadV1Project(target).file : createProjectFile(basename(target), { registries: [{ name: "central", url: server }] });
  for (const [name, spec] of Object.entries(packages)) {
    if (!(name in file.dependencies)) file.dependencies[name] = spec.version;
    if (spec.features.length) file.features[name] = { ...(file.features[name] ?? {}), ...Object.fromEntries(spec.features.map(feature => [feature, true])) };
  }
  saveProjectFile(target, file);
}

/** Options of `template use` itself, never a template's feature. */
const GENERAL_FLAGS = new Set(["--var", "--with", "--force", "--dry-run", "--sync", "--allow", "--help"]);

async function pickTemplate(api: ApiClient): Promise<string> {
  const templates = await api.templates();
  if (!templates.length) throw new Error("El servidor no tiene templates publicados. Crea uno con: modai template init ./mi-template");
  return askSearch({
    message: "Template (escribe para filtrar)", flag: "@scope/nombre",
    source: term => templates.filter(item => !term || `${item.name} ${item.description}`.toLowerCase().includes(term.toLowerCase()))
      .map(item => ({ value: `${item.name}@${item.version}`, name: `${item.name} ${hint(item.version)}`, description: item.description })),
  });
}

export function registerTemplateCommands(program: Command, print: Print): void {
  const template = group(program, "template", "Templates de proyecto: paquetes kind: Template que crean un proyecto nuevo (por ejemplo NestJS con SDD)");
  template.command("list").alias("ls").description("Templates publicados en el servidor").argument("[query]", "Filtra por nombre, categoría o etiqueta")
    .action(async (query?: string) => print((await serverApi().templates(query)).map(item => ({ name: item.name, version: item.version, category: item.manifest.spec?.category ?? "template", versions: item.versions, description: item.description }))));

  template.command("init").description("Crea el esqueleto de un template: README, AGENTS.md y un modai.template.yaml comentado")
    .argument("<directory>", "Carpeta nueva del template")
    .action((directory: string) => {
      const root = resolve(directory);
      if (existsSync(root) && readdirSync(root).length) throw new Error(`${root} no está vacía`);
      const files: Record<string, string> = {
        "README.md": "# {{projectName}}\n\nQué es este proyecto, cómo se instala y cómo se ejecuta.\n",
        "AGENTS.md": "# Instrucciones para agentes de {{projectName}}\n\nConvenciones, comandos de verificación y límites del proyecto.\n",
        ".gitignore": "node_modules/\ndist/\n.env\n.modai/store/\n",
        [TEMPLATE_MANIFEST]: [
          "# Opciones de este template: se activan con flags al usarlo (modai template use <template> --sdd).",
          "# Añádelas con: modai feature define . sdd --description \"Spec-Driven Development\" --path features/sdd",
          "# Guía completa: docs/guides/TEMPLATES.md",
          "features: {}",
          "",
        ].join("\n"),
      };
      for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content, { flag: "wx" }); }
      print(`Template creado en ${root}.\nOpciones:  modai feature define ${directory} <nombre> --description "…" --path features/<nombre>\nPublica:   modai template publish ${directory} --name @equipo/nombre@1.0.0 --description "…"`);
    });

  template.command("publish").description("Publica una carpeta o un .zip como versión inmutable de un template (un paquete kind: Template)")
    .argument("<source>", "Carpeta del proyecto modelo o archivo .zip")
    .requiredOption("--name <@scope/name@version>", "Nombre y versión del template, por ejemplo @equipo/nestjs-sdd@1.0.0")
    .requiredOption("--description <text>", "Qué incluye y para qué sirve")
    .option("--category <category>", "Categoría del catálogo (por defecto template), por ejemplo backend")
    .option("--tags <tags>", "Etiquetas separadas por comas (tecnologías, por ejemplo nestjs,postgres)", (value: string) => value.split(",").map(tag => tag.trim()).filter(Boolean))
    .action(async (source: string, options: { name: string; description: string; category?: string; tags?: string[] }) => {
      const { name, version } = splitSpec(options.name);
      if (!version) throw new Error("Indica la versión en --name, por ejemplo @equipo/nestjs-sdd@1.0.0");
      const path = resolve(source);
      const files = statSync(path).isDirectory() ? collect(path) : undefined;
      const content = files ? { files } : { archive: readFileSync(path).toString("base64") };
      if (files && !files.length) throw new Error("La carpeta no tiene archivos publicables (se excluyen node_modules, .git, dist y .env)");
      const published = await serverApi().importTemplate({ name, version, description: options.description, category: options.category, keywords: options.tags, ...content });
      print(`Publicado el template ${published.name}@${published.version}. Úsalo con: modai template use ${published.name} ./mi-proyecto`);
    });

  template.command("use").description("Crea un proyecto nuevo a partir de un template; sus features se activan con --<nombre> (modai template use <template> --help las lista)")
    .argument("[template]", "@scope/nombre[@versión]")
    .argument("[directory]", "Carpeta destino", ".")
    .option("--var <key=value...>", "Valores para los marcadores {{clave}} (projectName se deduce de la carpeta)")
    .option("--with <addon>", "Añade un add-on (otro template pensado para combinarse); se puede repetir", (value: string, previous: string[] = []) => [...previous, value])
    .option("--force", "Escribe aunque la carpeta no esté vacía (sobrescribe archivos con el mismo nombre)")
    .option("--dry-run", "Muestra qué se crearía sin escribir nada")
    .option("--sync", "Instala ya los paquetes MODAI que aportan las features elegidas")
    .option("--allow <permissions>", "Permisos de instalación para --sync", commaList)
    .helpOption(false).option("-h, --help", "Ayuda; con un template indicado, incluye las opciones que ese template declara")
    .allowUnknownOption().allowExcessArguments()
    .addHelpText("after", "\nLas features que declara un template son opciones de este comando: --sdd añade la feature sdd y --no-sdd quita una que viene activada.\nVer las de un template concreto: modai template use @scope/nombre --help")
    .action(async (_spec: string | undefined, _directory: string, options: { var?: string[]; with?: string[]; force?: boolean; dryRun?: boolean; sync?: boolean; allow?: string[]; help?: boolean }, command: Command) => {
      // Features are options the template defines, so commander cannot know them: read the raw tokens.
      const operands: string[] = [], flags: string[] = [];
      for (const token of command.args) (token.startsWith("-") ? flags : operands).push(token);
      const spec = operands[0], directory = operands[1] ?? ".";
      if (options.help || flags.includes("-h")) {
        if (!spec) { command.outputHelp(); return; }
        const { name, version } = splitSpec(spec);
        const { template: record, files } = await serverApi().templateFiles(name, version);
        print(templateHelp(record, manifestOf(files)));
        return;
      }
      // In a terminal, what is missing is asked: which template, where, and (below) which of its options.
      const api = serverApi();
      const chosenSpec = spec ?? (interactive() ? await pickTemplate(api) : undefined);
      if (!chosenSpec) throw new Error("Indica el template: modai template use @scope/nombre [carpeta]. Lista los disponibles con: modai template list");
      const { name, version } = splitSpec(chosenSpec);
      const target = resolve(operands[1] ?? (spec || !interactive() ? directory : await askText({ message: "Carpeta del proyecto nuevo", flag: "[carpeta]", default: `./${name.split("/")[1]}` })));
      if (existsSync(target) && readdirSync(target).length && !options.force && !options.dryRun) throw new Error(`${target} no está vacía. Usa otra carpeta o --force.`);
      const trust = await installationPolicy(api, isV1Project(process.cwd()) ? { signaturePolicy: loadV1Project(process.cwd()).file.signaturePolicy } : {});
      const { template: record, files } = await verifiedTemplate(api, name, version, trust);
      const manifest = manifestOf(files);
      if (!flags.some(flag => flag.startsWith("--") && !GENERAL_FLAGS.has(flag.split("=")[0]!)) && manifest.features.length && interactive()) {
        const on = await askCheckbox({ message: `Opciones de ${record.name}`, flag: "--<feature>", choices: manifest.features.map(feature => ({ value: feature.name, name: `--${feature.name}`, description: feature.description, checked: feature.default })) });
        flags.push(...manifest.features.filter(feature => on.includes(feature.name) !== feature.default).map(feature => on.includes(feature.name) ? `--${feature.name}` : `--no-${feature.name}`));
      }
      const selected = selectFeatures(manifest.features, templateChoice(flags, manifest, record.name), record.name);

      // External add-ons: those the chosen features use, then the ones asked with --with.
      const wanted = [...requiredAddons(manifest, selected), ...(options.with ?? [])];
      const addons = new Map<string, TemplateFile[]>();
      for (const addonSpec of new Set(wanted)) {
        const addonRef = splitSpec(addonSpec);
        const loaded = await verifiedTemplate(api, addonRef.name, addonRef.version, trust);
        const addonManifest = manifestOf(loaded.files);
        if (addonManifest.addon?.for.length && !addonManifest.addon.for.includes(record.name)) throw new Error(`${addonSpec} no está pensado para ${record.name}: solo para ${addonManifest.addon.for.join(", ")}`);
        addons.set(addonSpec, baseFiles(loaded.files, addonManifest));
      }
      const composed = composeTemplate({ files, manifest, selected, addons, extraAddons: options.with ?? [] });

      const variables: Record<string, string> = { projectName: basename(target), ...composed.variables };
      for (const pair of options.var ?? []) {
        const index = pair.indexOf("=");
        if (index < 1) throw new Error(`Variable inválida: ${pair}. Usa clave=valor.`);
        variables[pair.slice(0, index)] = pair.slice(index + 1);
      }
      const planned = composed.files.map(file => { const relative = applyVariables(file.path, variables); assertSafeRelativePath(relative, "path"); return { relative, content: file.content }; });
      const packages = Object.keys(composed.packages);
      const summary = [selected.length ? `features: ${selected.join(", ")}` : "", wanted.length ? `add-ons: ${[...new Set(wanted)].join(", ")}` : "", packages.length ? `paquetes: ${packages.join(", ")}` : ""].filter(Boolean).join(" · ");
      if (options.dryRun) { print(`Se crearían ${planned.length} archivos en ${target} desde ${record.name}@${record.version}${summary ? ` (${summary})` : ""}:\n${planned.map(file => `  ${file.relative}`).join("\n")}${packages.length ? `\nmodai.yaml: ${packages.map(name => `${name}@${composed.packages[name]!.version}${composed.packages[name]!.features.length ? ` (${composed.packages[name]!.features.map(feature => `--${feature}`).join(" ")})` : ""}`).join(", ")}` : ""}`); return; }
      mkdirSync(target, { recursive: true });
      for (const file of planned) {
        const destination = safeProjectPath(target, file.relative);
        mkdirSync(dirname(destination), { recursive: true });
        const bytes = Buffer.from(file.content, "base64");
        writeFileSync(destination, TEXT.test(file.relative) ? applyVariables(bytes.toString("utf8"), variables) : bytes);
      }
      if (packages.length) addTemplatePackages(target, composed.packages, effectiveConnection().server);
      print(`Proyecto creado en ${target} desde ${record.name}@${record.version} (${planned.length} archivos${summary ? `; ${summary}` : ""}).${composed.overwritten.length ? `\n${composed.overwritten.length} archivo(s) del template base fueron reemplazados por una capa: ${composed.overwritten.slice(0, 5).join(", ")}${composed.overwritten.length > 5 ? "…" : ""}` : ""}`);
      if (!packages.length) return;
      if (!options.sync) { print(`Los paquetes quedaron en modai.yaml. Instálalos con: cd ${directory} && modai sync`); return; }
      const { report } = await runSync(target, undefined, { allow: options.allow });
      print(summarize(report));
    });

  template.command("info").description("Versiones, features y archivos de un template")
    .argument("<template>", "@scope/nombre[@versión]")
    .action(async (spec: string) => {
      const { name, version } = splitSpec(spec);
      const api = serverApi();
      const info = await api.templateInfo(name, version);
      const versions = (await api.listPackages(name, true)).filter(item => item.name === name).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      print({ name: info.package.name, version: info.package.version, description: info.package.description, category: info.package.manifest.spec?.category ?? "template", tags: info.package.manifest.metadata?.keywords ?? [],
        versions: versions.map(item => `${item.version}${item.status === "yanked" ? " (retirada)" : item.status === "deprecated" ? " (deprecada)" : ""}`), ...(info.features?.length ? { features: info.features.map(item => `--${item.name}${item.default ? " (por defecto)" : ""}: ${item.description}`) } : {}), ...(info.addon ? { addon: `para ${info.addon.for.join(", ") || "cualquier template"}` } : {}), files: info.files.map(item => item.path) });
    });

  template.command("download").description("Descarga un template como .zip sin aplicar variables")
    .argument("<template>", "@scope/nombre[@versión]")
    .argument("[file]", "Archivo destino")
    .action(async (spec: string, file?: string) => {
      const { name, version } = splitSpec(spec);
      const api = serverApi();
      const { template: record, files } = await verifiedTemplate(api, name, version, await installationPolicy(api));
      const folder = record.name.split("/")[1]!;
      const output = resolve(file ?? `${folder}-${record.version}.zip`);
      writeFileSync(output, writeZip(files.map(item => ({ path: `${folder}/${item.path}`, bytes: Buffer.from(item.content, "base64") }))));
      print(`Descargado ${record.name}@${record.version} en ${output}`);
    });
}
