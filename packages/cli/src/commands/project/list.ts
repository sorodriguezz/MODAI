import { loadV1Project } from "@modai/core";
import type { Command } from "commander";
import { adapterRows, catalogEntries, type EntryOptions, LIST_TYPES, listRows } from "../../services/catalog.js";
import { currentProject, requireProject } from "../../services/project.js";
import { printList } from "../../terminal/output.js";

const LABELS: Record<string, string> = {
  packages: "paquetes",
  skills: "skills",
  rules: "reglas",
  knowledge: "documentos de conocimiento",
  tools: "herramientas",
  mcp: "servidores MCP",
  agents: "agentes",
  components: "componentes",
  files: "archivos",
  Profile: "perfiles",
};

function listAdapters(): void {
  const active = currentProject()?.file.adapters;
  printList(
    adapterRows().map((item) => ({
      adapter: item.definition.id,
      source: item.source,
      active: active?.includes(item.definition.id) ?? false,
      description: item.definition.description,
    })),
    "No hay adaptadores.",
  );
}

function listRegistries(): void {
  const project = loadV1Project(requireProject());
  printList(
    project.file.registries.map((item) => ({ registry: item.name, location: item.url ?? item.path })),
    "No hay registries configurados.",
  );
}

function listCapabilities(): void {
  const project = loadV1Project(requireProject());
  printList(
    Object.entries(project.lock.capabilities).map(([capability, item]) => ({
      capability,
      version: item.version,
      provider: item.provider,
    })),
    "Ningún paquete instalado provee capacidades.",
  );
}

function emptyMessage(matched: string, options: EntryOptions): string {
  const scope = options.available || options.registry ? "en los registries" : "instalados en este proyecto";
  const hint = matched.startsWith("category:") ? `\nTipos admitidos: ${LIST_TYPES.join(", ")}.` : "";
  return `No hay ${LABELS[matched] ?? matched.replace(/^category:/, "paquetes de la categoría ")} ${scope}.${hint}${options.available ? "" : "\nPrueba con --available para ver lo publicado."}`;
}

export async function listInstalled(type: string | undefined, options: EntryOptions): Promise<void> {
  const what = (type ?? "packages").toLowerCase();
  if (["adapters", "adapter", "adaptadores"].includes(what) && !options.available) return listAdapters();
  if (["registries", "registry", "registros"].includes(what)) return listRegistries();
  if (["capabilities", "capability", "capacidades"].includes(what)) return listCapabilities();
  const entries = await catalogEntries(options);
  const { rows, matched } = listRows(what === "adapters" || what === "adapter" ? "adapter" : what, entries);
  printList(rows, emptyMessage(matched, options));
}

export function registerList(program: Command): void {
  program
    .command("list")
    .alias("ls")
    .description(
      "Lista lo instalado en el proyecto (o con --available, lo publicado): packages, skills, components, tools, harness, profiles…",
    )
    .argument("[type]", `Qué listar: ${LIST_TYPES.join(", ")}`, "packages")
    .option("--available", "Lista lo publicado en los registries en lugar de lo instalado")
    .option("--registry <name|url|path>", "Registry concreto (implica --available)")
    .option("--query <text>", "Filtro de texto")
    .action((type: string, options: EntryOptions) => listInstalled(type, options));
}
