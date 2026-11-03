import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Command } from "commander";
import YAML from "yaml";
import { API_VERSION, type PackageManifestV1 } from "@modai/contracts/spec-v1";
import {
  BUILTIN_ADAPTERS, HttpRegistry, LocalRegistry, availableAdapters, expandTemplate, inspectWorkspace, isV1Project, loadV1Project, normalizeManifest, type Registry,
} from "@modai/core";
import { loadClientConfig } from "../cli/config.js";
import { defaultLocalRegistry, projectRegistry, registryFromArgument, requireV1Project, tokenFor } from "./runtime.js";

import { formatTable, printList, type Print } from "../cli/output.js";
type Row = Record<string, string | number | boolean | undefined>;
interface Entry { name: string; version: string; manifest: PackageManifestV1; installed: boolean; registry?: string }

/** Listings over contributions: one row per contributed item. */
const CONTRIBUTIONS: Record<string, { aliases: string[]; rows: (entry: Entry) => Row[] }> = {
  skills: { aliases: ["skill"], rows: e => e.manifest.spec.contributes.skills.map(item => ({ skill: item.name, package: e.name, version: e.version, path: item.path })) },
  rules: { aliases: ["rule", "reglas"], rows: e => e.manifest.spec.contributes.rules.map(item => ({ rule: item.name, package: e.name, version: e.version, description: item.description })) },
  knowledge: { aliases: ["conocimiento", "docs"], rows: e => e.manifest.spec.contributes.knowledge.map(item => ({ title: item.title, package: e.name, version: e.version, path: item.path })) },
  tools: { aliases: ["tool", "herramientas"], rows: e => e.manifest.spec.contributes.tools.map(item => ({ tool: item.name, package: e.name, version: e.version, implements: item.implements, description: item.description })) },
  mcp: { aliases: ["mcp-servers", "mcpservers", "servers"], rows: e => e.manifest.spec.contributes.mcpServers.map(item => ({ server: item.name, package: e.name, version: e.version, command: `${item.command} ${item.args.join(" ")}`.trim() })) },
  agents: { aliases: ["agent", "agentes"], rows: e => e.manifest.spec.contributes.agents.map(item => ({ agent: item.name, package: e.name, version: e.version })) },
  components: { aliases: ["component", "componentes", "modules", "modulos"], rows: e => e.manifest.spec.contributes.components.map(item => ({
    component: item.name, package: e.name, version: e.version, target: expandTemplate(item.target, { component: item.name, package: e.name }), language: item.language, description: item.description,
  })) },
  files: { aliases: ["file", "archivos"], rows: e => e.manifest.spec.contributes.files.map(item => ({ target: item.target, package: e.name, version: e.version })) },
};
/** Listings over packages filtered by kind; anything else is treated as a category (harness, testing, frontend...). */
const KINDS: Record<string, string> = { profiles: "Profile", profile: "Profile", perfiles: "Profile", templates: "Template", template: "Template", plantillas: "Template" };
const CATEGORY_ALIASES: Record<string, string> = { harnesses: "harness", arneses: "harness", components: "component" };
export const LIST_TYPES = ["packages", ...Object.keys(CONTRIBUTIONS), "profiles", "templates", "adapters", "registries", "capabilities", "<categoría>"];

function packageRow(entry: Entry): Row {
  return { package: entry.name, version: entry.version, kind: entry.manifest.kind, category: entry.manifest.spec.category, ...(entry.registry ? { registry: entry.registry, installed: entry.installed } : {}), description: entry.manifest.metadata.description };
}

export function listRows(type: string, entries: Entry[]): { rows: Row[]; matched: string } {
  const what = type.toLowerCase();
  if (["", "packages", "package", "paquetes", "all"].includes(what)) return { rows: entries.map(packageRow), matched: "packages" };
  const contribution = Object.entries(CONTRIBUTIONS).find(([key, value]) => key === what || value.aliases.includes(what));
  if (contribution) return { rows: entries.flatMap(contribution[1].rows), matched: contribution[0] };
  if (KINDS[what]) return { rows: entries.filter(entry => entry.manifest.kind === KINDS[what]).map(packageRow), matched: KINDS[what] };
  const category = CATEGORY_ALIASES[what] ?? what.replace(/s$/, "");
  return { rows: entries.filter(entry => [what, category].includes(entry.manifest.spec.category)).map(packageRow), matched: `category:${category}` };
}

export { formatTable };

function availableRegistry(options: { registry?: string }): Registry {
  const root = process.cwd();
  const project = isV1Project(root) ? loadV1Project(root) : undefined;
  if (options.registry) return registryFromArgument(options.registry, project);
  if (project) return projectRegistry(project);
  const server = process.env.MODAI_SERVER || loadClientConfig()?.server;
  return server ? new HttpRegistry(server, tokenFor(server)) : new LocalRegistry(defaultLocalRegistry());
}

/** What the project's registries (or the connected server) publish, for pickers that let the person choose a package. */
export async function availableEntries(query?: string): Promise<Array<{ name: string; version: string; manifest: PackageManifestV1 }>> {
  return entriesFor({ available: true, query });
}

async function entriesFor(options: { available?: boolean; registry?: string; query?: string }): Promise<Entry[]> {
  const root = process.cwd();
  const installed = isV1Project(root) ? loadV1Project(root).lock.packages : {};
  if (options.available || options.registry) {
    const list = await availableRegistry(options).list(options.query);
    return list.flatMap(item => {
      try { return [{ name: item.name, version: item.version, manifest: normalizeManifest(item.manifest), installed: installed[item.name]?.version === item.version, registry: item.registry }]; }
      catch { return []; }
    });
  }
  if (!isV1Project(root)) throw new Error("No es un proyecto MODAI: ejecuta 'modai init', o usa --available para listar lo publicado en los registries.");
  const query = options.query?.toLowerCase();
  return inspectWorkspace(loadV1Project(root))
    .filter(item => !query || `${item.name} ${item.manifest.metadata.description}`.toLowerCase().includes(query))
    .map(item => ({ name: item.name, version: item.version, manifest: item.manifest, installed: true }));
}

export async function listV1(type: string | undefined, options: { available?: boolean; registry?: string; query?: string }, _print: Print): Promise<void> {
  const what = (type ?? "packages").toLowerCase();
  const output = (rows: Row[], empty: string) => printList(rows, empty);
  if (["adapters", "adapter", "adaptadores"].includes(what) && !options.available) {
    const root = process.cwd();
    const project = isV1Project(root) ? loadV1Project(root) : undefined;
    const installed = project ? inspectWorkspace(project).map(item => ({ name: item.name, manifest: item.manifest })) : [];
    const adapters = installed.length ? availableAdapters(installed) : BUILTIN_ADAPTERS.map(definition => ({ definition, source: "builtin" }));
    return output(adapters.map(item => ({ adapter: item.definition.id, source: item.source, active: project?.file.adapters.includes(item.definition.id) ?? false, description: item.definition.description })), "No hay adaptadores.");
  }
  if (["registries", "registry", "registros"].includes(what)) {
    const project = loadV1Project(requireV1Project());
    return output(project.file.registries.map(item => ({ registry: item.name, location: item.url ?? item.path })), "No hay registries configurados.");
  }
  if (["capabilities", "capability", "capacidades"].includes(what)) {
    const project = loadV1Project(requireV1Project());
    return output(Object.entries(project.lock.capabilities).map(([capability, item]) => ({ capability, version: item.version, provider: item.provider })), "Ningún paquete instalado provee capacidades.");
  }
  const entries = await entriesFor(options);
  const { rows, matched } = listRows(what === "adapters" || what === "adapter" ? "adapter" : what, entries);
  const scope = options.available || options.registry ? "en los registries" : "instalados en este proyecto";
  const hint = matched.startsWith("category:") ? `\nTipos admitidos: ${LIST_TYPES.join(", ")}.` : "";
  const labels: Record<string, string> = { packages: "paquetes", skills: "skills", rules: "reglas", knowledge: "documentos de conocimiento", tools: "herramientas", mcp: "servidores MCP", agents: "agentes", components: "componentes", files: "archivos", Profile: "perfiles" };
  output(rows, `No hay ${labels[matched] ?? matched.replace(/^category:/, "paquetes de la categoría ")} ${scope}.${hint}${options.available ? "" : "\nPrueba con --available para ver lo publicado."}`);
}

/** Packages existing user code (a backend module, a UI component...) as a reusable component package. */
export function createComponentPackage(directory: string, options: { name: string; from?: string; target?: string; component?: string; description?: string; version?: string; language?: string; category?: string; tags?: string[] }): string {
  const root = resolve(directory);
  if (existsSync(root)) throw new Error(`La carpeta ya existe: ${root}`);
  const short = options.name.split("/").pop()!.replace(/[^a-z0-9-]/g, "-");
  const component = (options.component ?? (options.from ? basename(resolve(options.from)) : short)).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+/, "").slice(0, 64) || short;
  mkdirSync(join(root, "component"), { recursive: true });
  if (options.from) {
    const source = resolve(options.from);
    if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`--from debe ser una carpeta existente: ${source}`);
    if (resolve(root).startsWith(`${source}/`)) throw new Error("La carpeta del paquete no puede estar dentro de --from");
    cpSync(source, join(root, "component"), { recursive: true, filter: path => !/(^|[\\/])(node_modules|\.git|dist|\.DS_Store)$/.test(path) });
  } else {
    writeFileSync(join(root, "component", "README.md"), `# ${component}\n\nCódigo del componente. Todo lo que pongas en esta carpeta se instala en el destino declarado en modai.package.yaml.\n`);
  }
  const manifest = {
    apiVersion: API_VERSION, kind: "Package",
    metadata: { name: options.name, version: options.version ?? "0.1.0", description: options.description ?? `Componente ${component}: describe qué resuelve, cómo se integra y qué dependencias espera.` },
    spec: {
      category: options.category ?? "component",
      permissions: ["project.source"],
      contributes: { components: [{ name: component, description: options.description, path: "component", target: options.target ?? "src/modules/{component}", ...(options.language ? { language: options.language } : {}), tags: options.tags ?? [] }] },
    },
  };
  writeFileSync(join(root, "modai.package.yaml"), YAML.stringify(manifest, { lineWidth: 0 }), { flag: "wx" });
  return root;
}

export function registerListCommands(program: Command, print: Print, commaList: (value: string) => string[]): void {
  program.command("list").alias("ls")
    .description("Lista lo instalado en el proyecto (o con --available, lo publicado): packages, skills, components, tools, harness, profiles…")
    .argument("[type]", `Qué listar: ${LIST_TYPES.join(", ")}`, "packages")
    .option("--available", "Lista lo publicado en los registries en lugar de lo instalado")
    .option("--registry <name|url|path>", "Registry concreto (implica --available)")
    .option("--query <text>", "Filtro de texto")
    .action((type: string, options) => listV1(type, options, print));

  const component = program.command("component").description("Componentes de código reutilizables (módulos de backend, componentes de UI, servicios…)");
  component.command("create").argument("<directory>", "Carpeta del nuevo paquete")
    .description("Empaqueta código existente (--from) o crea un esqueleto como componente instalable")
    .requiredOption("--name <name>", "@scope/nombre")
    .option("--from <directory>", "Carpeta con el código que quieres reutilizar")
    .option("--target <path>", "Destino en el proyecto que lo instale; admite {component} y {package}", "src/modules/{component}")
    .option("--component <name>", "Nombre del componente (por defecto, el de la carpeta --from)")
    .option("--description <text>")
    .option("--version <semver>", "Versión inicial", "0.1.0")
    .option("--language <language>", "Lenguaje o framework informativo: typescript, nestjs, python…")
    .option("--category <category>", "Categoría informativa", "component")
    .option("--tags <tags>", "Etiquetas separadas por comas", commaList)
    .action((directory: string, options) => {
      const created = createComponentPackage(directory, options);
      print(`Componente creado en ${created}\nValida:   modai package validate ${directory}\nPublica:  modai package publish ${directory} --registry <registry>\nInstala:  modai add ${options.name} --allow project.source`);
    });
  component.command("list").description("Componentes instalados (o --available)").option("--available").option("--registry <name|url|path>").option("--query <text>")
    .action(options => listV1("components", options, print));
}
