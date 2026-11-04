import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { composeTemplate, isV1Project, loadV1Project, selectFeatures } from "@modai/core";
import type { ApiClient } from "@modai/sdk";
import type { Command } from "commander";
import { effectiveConnection, serverApi } from "../../services/connection.js";
import { splitVersionSpec } from "../../services/package-spec.js";
import { runSync } from "../../services/sync.js";
import {
  addTemplatePackages,
  manifestOf,
  templateChoice,
  templateVariables,
  verifiedTemplate,
} from "../../services/templates.js";
import { installationPolicy } from "../../services/trust.js";
import { commaList, repeatable } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";
import { askSearch, askText, hint, interactive } from "../../terminal/prompts.js";
import { summarize } from "../../terminal/sync-summary.js";
import { templateHelp } from "../../terminal/template-help.js";
import {
  askFeatures,
  createdText,
  dryRunText,
  loadAddons,
  planFiles,
  splitArgs,
  summaryText,
  wantedAddons,
  writeFiles,
} from "./use-steps.js";

type UseOptions = {
  var?: string[];
  with?: string[];
  force?: boolean;
  dryRun?: boolean;
  sync?: boolean;
  allow?: string[];
  help?: boolean;
};

async function pickTemplate(api: ApiClient): Promise<string> {
  const templates = await api.templates();
  if (!templates.length)
    throw new Error("El servidor no tiene templates publicados. Crea uno con: modai template init ./mi-template");
  return askSearch({
    message: "Template (escribe para filtrar)",
    flag: "@scope/nombre",
    source: (term) =>
      templates
        .filter((item) => !term || `${item.name} ${item.description}`.toLowerCase().includes(term.toLowerCase()))
        .map((item) => ({
          value: `${item.name}@${item.version}`,
          name: `${item.name} ${hint(item.version)}`,
          description: item.description,
        })),
  });
}

async function targetDirectory(operands: string[], spec: string | undefined, name: string): Promise<string> {
  if (operands[1]) return resolve(operands[1]);
  if (spec || !interactive()) return resolve(".");
  return resolve(
    await askText({ message: "Carpeta del proyecto nuevo", flag: "[carpeta]", default: `./${name.split("/")[1]}` }),
  );
}

async function useTemplate(args: string[], options: UseOptions, print: Print): Promise<void> {
  const { operands, flags } = splitArgs(args);
  const spec = operands[0];
  const api = serverApi();
  const chosenSpec = spec ?? (interactive() ? await pickTemplate(api) : undefined);
  if (!chosenSpec)
    throw new Error(
      "Indica el template: modai template use @scope/nombre [carpeta]. Lista los disponibles con: modai template list",
    );
  const { name, version } = splitVersionSpec(chosenSpec);
  const target = await targetDirectory(operands, spec, name);
  if (existsSync(target) && readdirSync(target).length && !options.force && !options.dryRun)
    throw new Error(`${target} no está vacía. Usa otra carpeta o --force.`);
  const cwd = process.cwd();
  const trust = await installationPolicy(
    api,
    isV1Project(cwd) ? { signaturePolicy: loadV1Project(cwd).file.signaturePolicy } : {},
  );
  const { template: record, files } = await verifiedTemplate(api, name, version, trust);
  const manifest = manifestOf(files);
  await askFeatures(manifest, record.name, flags);
  const selected = selectFeatures(manifest.features, templateChoice(flags, manifest, record.name), record.name);
  const wanted = wantedAddons(manifest, selected, options.with ?? []);
  const addons = await loadAddons(api, trust, record.name, wanted);
  const composed = composeTemplate({ files, manifest, selected, addons, extraAddons: options.with ?? [] });
  const variables = templateVariables(options.var ?? [], { projectName: basename(target), ...composed.variables });
  const planned = planFiles(composed, variables);
  const packages = Object.keys(composed.packages);
  const summary = summaryText(selected, wanted, packages);
  if (options.dryRun) return print(dryRunText(target, record, planned, composed, summary));
  writeFiles(target, planned, variables);
  if (packages.length) addTemplatePackages(target, composed.packages, effectiveConnection().server);
  print(createdText(target, record, planned, composed, summary));
  if (!packages.length) return;
  if (!options.sync)
    return print(`Los paquetes quedaron en modai.yaml. Instálalos con: cd ${operands[1] ?? "."} && modai sync`);
  const { report } = await runSync(target, undefined, { allow: options.allow });
  print(summarize(report));
}

async function showHelp(args: string[], command: Command, print: Print): Promise<void> {
  const spec = splitArgs(args).operands[0];
  if (!spec) {
    command.outputHelp();
    return;
  }
  const { name, version } = splitVersionSpec(spec);
  const { template: record, files } = await serverApi().templateFiles(name, version);
  print(templateHelp(record, manifestOf(files)));
}

export function registerTemplateUse(template: Command, print: Print): void {
  template
    .command("use")
    .description(
      "Crea un proyecto nuevo a partir de un template; sus features se activan con --<nombre> (modai template use <template> --help las lista)",
    )
    .argument("[template]", "@scope/nombre[@versión]")
    .argument("[directory]", "Carpeta destino", ".")
    .option("--var <key=value...>", "Valores para los marcadores {{clave}} (projectName se deduce de la carpeta)")
    .option("--with <addon>", "Añade un add-on (otro template pensado para combinarse); se puede repetir", repeatable)
    .option("--force", "Escribe aunque la carpeta no esté vacía (sobrescribe archivos con el mismo nombre)")
    .option("--dry-run", "Muestra qué se crearía sin escribir nada")
    .option("--sync", "Instala ya los paquetes MODAI que aportan las features elegidas")
    .option("--allow <permissions>", "Permisos de instalación para --sync", commaList)
    .helpOption(false)
    .option("-h, --help", "Ayuda; con un template indicado, incluye las opciones que ese template declara")
    .allowUnknownOption()
    .allowExcessArguments()
    .addHelpText(
      "after",
      "\nLas features que declara un template son opciones de este comando: --sdd añade la feature sdd y --no-sdd quita una que viene activada.\nVer las de un template concreto: modai template use @scope/nombre --help",
    )
    .action(async (_spec: string | undefined, _directory: string, options: UseOptions, command: Command) => {
      if (options.help || command.args.includes("-h")) return showHelp(command.args, command, print);
      return useTemplate(command.args, options, print);
    });
}
