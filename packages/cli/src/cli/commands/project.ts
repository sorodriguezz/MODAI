import { basename } from "node:path";
import { BUILTIN_ADAPTERS, isV1Project, packageFeatureRules } from "@modai/core";
import { ApiClient } from "@modai/sdk";
import type { Command } from "commander";
import semver from "semver";
import { addV1, capabilitiesV1, initV1, outdatedV1, removeV1, statusV1, syncV1, updateV1 } from "../../v1/commands.js";
import {
  featureChoice,
  manifestForSpec,
  packageHelp,
  registerFeatureCommands,
  splitPackageFlags,
} from "../../v1/features.js";
import { availableEntries } from "../../v1/list.js";
import { requireV1Project, runSync, summarize, tokenFor } from "../../v1/runtime.js";
import { commaList } from "../agent-commands.js";
import { loadClientConfig } from "../config.js";
import { group } from "../groups.js";
import type { Print } from "../output.js";
import { askCheckbox, askSearch, askSelect, askText, hint, interactive } from "../ui.js";

/** Project lifecycle: modai.yaml + modai.lock. */
export function registerProjectCommands(program: Command, print: Print): void {
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
    .action(async (options: Parameters<typeof initV1>[1]) => {
      // Without options, a person at the keyboard is walked through the choices; scripts keep passing flags.
      if (isV1Project(process.cwd())) throw new Error("El proyecto ya está inicializado (modai.yaml existe).");
      if (interactive() && !Object.values(options).some((value) => value !== undefined))
        Object.assign(options, await initWizard());
      await initV1(process.cwd(), options, print);
    });

  program
    .command("add")
    .description(
      "Añade paquetes (y sus dependencias) al proyecto. Las features de cada paquete se activan con --<feature> después de su nombre",
    )
    .argument(
      "[packages...]",
      "@scope/nombre[@rango] o file:../ruta, cada uno seguido de sus flags (--tls, --no-metrics)",
    )
    .option("--allow <permissions>", "Permisos de instalación concedidos en este equipo", commaList)
    .option("--force", "Sobrescribe archivos administrados que fueron modificados")
    .option("--keep-mine", "Conserva tus archivos modificados y deja la versión nueva al lado (.modai-new)")
    .helpOption(false)
    .option("-h, --help", "Ayuda; con un paquete indicado, muestra también las features que declara")
    .allowUnknownOption()
    .allowExcessArguments()
    .addHelpText(
      "after",
      "\nEjemplo: modai add @eq/health --tls @eq/auth --jwt --no-sessions\nCada flag se aplica al paquete escrito antes. Las features que ofrece un paquete: modai add @scope/paquete --help",
    )
    .action(
      async (
        _specs: string[],
        options: { allow?: string[]; force?: boolean; keepMine?: boolean; help?: boolean },
        command: Command,
      ) => {
        // Feature flags are defined by each package, so commander cannot know them: read the raw tokens in order.
        const groups = splitPackageFlags(command.args.filter((token) => token !== "-h"));
        if (options.help || command.args.includes("-h")) {
          if (!groups.length) {
            command.outputHelp();
            return;
          }
          for (const item of groups) print(packageHelp(await manifestForSpec(item.spec)));
          return;
        }
        if (!groups.length && interactive()) groups.push(await pickPackage());
        if (!groups.length) throw new Error("Indica al menos un paquete: modai add @scope/paquete [--feature]");
        const root = requireV1Project();
        const features: Record<string, Record<string, boolean>> = {};
        for (const item of groups) {
          if (!item.flags.length) continue;
          const manifest = await manifestForSpec(item.spec, root);
          features[manifest.metadata.name] = featureChoice(manifest, item.flags);
        }
        await addV1(
          root,
          groups.map((item) => item.spec),
          { ...options, features },
          print,
        );
      },
    );

  program
    .command("remove")
    .description("Retira una dependencia directa conservando los archivos que modificaste")
    .argument("<package>", "@scope/nombre")
    .action((name: string) => removeV1(requireV1Project(), name, print));

  program
    .command("sync")
    .description("Reconstruye el entorno exacto desde modai.yaml y modai.lock")
    .option("--allow <permissions>", "Permisos de instalación aprobados en este equipo", commaList)
    .option("--frozen", "Falla si modai.lock no corresponde a modai.yaml (CI)")
    .option("--force", "Sobrescribe archivos administrados que fueron modificados")
    .option("--keep-mine", "Conserva tus archivos modificados y deja la versión nueva al lado (.modai-new)")
    .action((options) => syncV1(requireV1Project(), options, print));

  program
    .command("update")
    .description("Actualiza dependencias dentro de los rangos de modai.yaml")
    .argument("[packages...]", "Paquetes a actualizar; por defecto todos")
    .option(
      "--keep-mine",
      "Si modificaste archivos administrados, conserva tu versión y deja la nueva al lado (.modai-new)",
    )
    .option("--force", "Sobrescribe tus cambios en archivos administrados")
    .action((names: string[] = [], options: { keepMine?: boolean; force?: boolean }) =>
      updateV1(requireV1Project(), names, options, print),
    );

  registerFeatureCommands(program, print);

  program
    .command("outdated")
    .description("Compara el lock con las versiones disponibles en los registries")
    .action(() => outdatedV1(requireV1Project(), print));
  program
    .command("status")
    .description("Muestra el estado del proyecto")
    .action(() => statusV1(requireV1Project(), print));
  group(program, "capability", "Capacidades del proyecto: contratos, proveedores y herramientas ejecutables")
    .command("list", { isDefault: true })
    .description("Contratos provistos y requeridos, herramientas, servidores MCP y skills del proyecto")
    .action(() => capabilitiesV1(requireV1Project(), print));

  program
    .command("override")
    .description("Fija una versión o rango incluso si es una dependencia transitiva")
    .argument("<package>")
    .argument("<range>")
    .action(async (name: string, range: string) => {
      if (!semver.validRange(range)) throw new Error(`Rango SemVer inválido: ${range}`);
      const { report } = await runSync(requireV1Project(), (file) => {
        file.overrides[name] = range;
      });
      print(`Override aplicado: ${name}@${range}\n${summarize(report)}`);
    });
}

/** `modai init` with no flags in a terminal: name, adapters and, when connected, the server project to link. */
async function initWizard(): Promise<Parameters<typeof initV1>[1]> {
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
  const server = loadClientConfig()?.server;
  let project: string | undefined;
  if (server) {
    const projects = await new ApiClient(server, tokenFor(server)).projects().catch(() => []);
    if (projects.length) {
      project = await askSelect<string | undefined>({
        message: `¿Vincular a un proyecto de ${server}? ${hint("(comparte memoria y habilita agentes)")}`,
        flag: "--project",
        choices: [
          { value: undefined, name: "No, memoria local" },
          ...projects.map((item) => ({ value: item.id, name: item.name, description: item.id })),
        ],
      });
    }
  }
  const profile = await askText({
    message: `Perfil o paquete inicial ${hint("(opcional, Enter para omitir)")}`,
    flag: "--profile",
    default: "",
  });
  return { name, adapter, ...(project ? { project } : {}), ...(profile ? { profile } : {}) };
}

/** `modai add` with no package in a terminal: search the catalog, then pick the package's options. */
async function pickPackage(): Promise<{ spec: string; flags: string[] }> {
  const entries = (await availableEntries()).filter((entry) => entry.manifest.kind !== "Template");
  if (!entries.length) throw new Error("Los registries del proyecto no publican paquetes todavía.");
  const chosen = await askSearch({
    message: "Paquete a añadir (escribe para filtrar)",
    flag: "@scope/paquete",
    source: (term) =>
      entries
        .filter(
          (entry) =>
            !term || `${entry.name} ${entry.manifest.metadata.description}`.toLowerCase().includes(term.toLowerCase()),
        )
        .map((entry) => ({
          value: entry,
          name: `${entry.name} ${hint(entry.version)}`,
          description: entry.manifest.metadata.description,
        })),
  });
  const rules = packageFeatureRules(chosen.manifest);
  if (!rules.length) return { spec: chosen.name, flags: [] };
  const on = await askCheckbox({
    message: `Opciones de ${chosen.name}`,
    flag: "--<feature>",
    choices: rules.map((rule) => ({
      value: rule.name,
      name: `--${rule.name}`,
      description: rule.description,
      checked: rule.default,
    })),
  });
  // Flags relative to the defaults: --x turns one on, --no-x turns a default one off.
  return {
    spec: chosen.name,
    flags: [
      ...rules.filter((rule) => on.includes(rule.name) && !rule.default).map((rule) => `--${rule.name}`),
      ...rules.filter((rule) => rule.default && !on.includes(rule.name)).map((rule) => `--no-${rule.name}`),
    ],
  };
}
