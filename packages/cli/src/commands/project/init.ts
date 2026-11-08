import { basename } from "node:path";
import type { ProjectFile, RegistrySource } from "@modai/contracts/manifest";
import { BUILTIN_ADAPTERS, createProjectFile, isV1Project, saveProjectFile } from "@modai/core";
import { ApiClient } from "@modai/sdk";
import type { Command } from "commander";
import { loadClientConfig } from "../../services/config.js";
import { tokenFor } from "../../services/connection.js";
import { parseSpec } from "../../services/packages.js";
import { defaultLocalRegistry, registrySource } from "../../services/registries.js";
import { runSync } from "../../services/sync.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";
import { askCheckbox, askSelect, askText, hint, interactive } from "../../terminal/prompts.js";
import { summarize } from "../../terminal/sync-summary.js";

export interface InitOptions {
  name?: string;
  registry?: string[];
  adapter?: string[];
  allow?: string[];
  profile?: string;
  memory?: string;
  project?: string;
  server?: string;
  delivery?: ProjectFile["context"]["delivery"];
}

function initialRegistries(root: string, options: InitOptions, server?: string): RegistrySource[] {
  if (options.registry?.length)
    return options.registry.map((value, index) =>
      registrySource(index ? `registry-${index + 1}` : "default", value, root),
    );
  return server ? [{ name: "central", url: server }] : [{ name: "local", path: defaultLocalRegistry() }];
}

async function initialContext(options: InitOptions, server?: string): Promise<ProjectFile["context"]> {
  const context: ProjectFile["context"] = {
    memory: (options.memory as "local") ?? (options.project ? "remote" : "local"),
    ...(options.delivery ? { delivery: options.delivery } : {}),
  };
  if (options.delivery && !options.project) throw new Error("--delivery requiere --project");
  if (!options.project) return context;
  if (!server) throw new Error("--project requiere un servidor conectado (modai server connect <url>) o --server");
  const api = new ApiClient(server, tokenFor(server));
  if (!(await api.projects()).some((project) => project.id === options.project))
    throw new Error("Proyecto no autorizado para esta clave");
  return Object.assign(context, { server, projectId: options.project });
}

export async function initProject(root: string, options: InitOptions, print: Print): Promise<void> {
  if (isV1Project(root)) throw new Error("El proyecto ya está inicializado (modai.yaml existe).");
  const server = (options.server ?? process.env.MODAI_SERVER ?? loadClientConfig()?.server)?.replace(/\/+$/, "");
  const registries = initialRegistries(root, options, server);
  const context = await initialContext(options, server);
  const file = createProjectFile(options.name ?? basename(root), {
    registries,
    context,
    ...(options.adapter?.length ? { adapters: options.adapter } : {}),
  });
  saveProjectFile(root, file);
  const profile = options.profile;
  try {
    const { report } = await runSync(
      root,
      profile
        ? (draft) => {
            const spec = parseSpec(profile, root);
            draft.dependencies[spec.name] = spec.value;
          }
        : undefined,
      { allow: options.allow },
    );
    print(
      `Proyecto MODAI inicializado en ${root}\nRegistries: ${registries.map((item) => item.url ?? item.path).join(", ")}\nAdaptadores: ${file.adapters.join(", ")}\n${summarize(report)}\nSiguiente paso: modai add @scope/paquete`,
    );
  } catch (error) {
    print(`modai.yaml creado, pero la primera sincronización falló: ${(error as Error).message}`);
    throw error;
  }
}

async function pickServerProject(): Promise<string | undefined> {
  const server = loadClientConfig()?.server;
  if (!server) return undefined;
  const projects = await new ApiClient(server, tokenFor(server)).projects().catch(() => []);
  if (!projects.length) return undefined;
  return askSelect<string | undefined>({
    message: `¿Vincular a un proyecto de ${server}? ${hint("(comparte memoria y habilita agentes)")}`,
    flag: "--project",
    choices: [
      { value: undefined, name: "No, memoria local" },
      ...projects.map((item) => ({ value: item.id, name: item.name, description: item.id })),
    ],
  });
}

async function initWizard(): Promise<InitOptions> {
  const name = await askText({ message: "Nombre del proyecto", flag: "--name", default: basename(process.cwd()) });
  const adapter = await askCheckbox({
    message: "¿Para qué agentes instalar las capacidades?",
    flag: "--adapter",
    choices: BUILTIN_ADAPTERS.map((item) => ({
      value: item.id,
      name: item.id,
      description: item.description,
      checked: ["agent-skills", "mcp"].includes(item.id),
    })),
  });
  const project = await pickServerProject();
  const profile = await askText({
    message: `Perfil o paquete inicial ${hint("(opcional, Enter para omitir)")}`,
    flag: "--profile",
    default: "",
  });
  return { name, adapter, ...(project ? { project } : {}), ...(profile ? { profile } : {}) };
}

export function registerInit(program: Command, print: Print): void {
  program
    .command("init")
    .description("Inicializa MODAI en el proyecto actual (modai.yaml); no requiere servidor")
    .option("--name <name>", "Nombre del proyecto")
    .option(
      "--registry <url|path>",
      "Registry de paquetes: URL de un servidor MODAI o carpeta local (repetible)",
      commaList,
    )
    .option("--adapter <ids>", "Adaptadores activos, por ejemplo agent-skills,agents-md,claude-code,mcp", commaList)
    .option("--profile <package>", "Perfil o paquete inicial, por ejemplo @profiles/fullstack-quality")
    .option("--allow <permissions>", "Permisos de instalación concedidos en este equipo", commaList)
    .option("--memory <mode>", "Memoria: local, remote u off")
    .option("--project <id>", "Proyecto del servidor: comparte su memoria y habilita agentes y ejecuciones")
    .option("--server <url>", "Servidor MODAI específico para este proyecto")
    .option("--delivery <mode>", "Entrega del perfil central: virtual o materialized")
    .action(async (options: InitOptions) => {
      if (isV1Project(process.cwd())) throw new Error("El proyecto ya está inicializado (modai.yaml existe).");
      if (interactive() && !Object.values(options).some((value) => value !== undefined))
        Object.assign(options, await initWizard());
      await initProject(process.cwd(), options, print);
    });
}
