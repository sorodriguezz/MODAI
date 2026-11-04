import { packageFeatureRules } from "@modai/core";
import type { Command } from "commander";
import { availableEntries } from "../../services/catalog.js";
import { featureChoices, manifestForSpec, type PackageFlags, splitPackageFlags } from "../../services/features.js";
import { addPackages, featuresText } from "../../services/packages.js";
import { requireProject } from "../../services/project.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";
import { packageHelp } from "../../terminal/package-help.js";
import { askCheckbox, askSearch, hint, interactive } from "../../terminal/prompts.js";
import { summarize } from "../../terminal/sync-summary.js";

type AddFlags = { allow?: string[]; force?: boolean; keepMine?: boolean; help?: boolean };

async function pickPackage(): Promise<PackageFlags> {
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
  return {
    spec: chosen.name,
    flags: [
      ...rules.filter((rule) => on.includes(rule.name) && !rule.default).map((rule) => `--${rule.name}`),
      ...rules.filter((rule) => rule.default && !on.includes(rule.name)).map((rule) => `--no-${rule.name}`),
    ],
  };
}

async function showHelp(groups: PackageFlags[], command: Command, print: Print): Promise<void> {
  if (!groups.length) {
    command.outputHelp();
    return;
  }
  for (const item of groups) print(packageHelp(await manifestForSpec(item.spec)));
}

async function add(groups: PackageFlags[], options: AddFlags, print: Print): Promise<void> {
  if (!groups.length && interactive()) groups.push(await pickPackage());
  if (!groups.length) throw new Error("Indica al menos un paquete: modai add @scope/paquete [--feature]");
  const root = requireProject();
  const features = await featureChoices(groups, root);
  const { names, report, needsGrant } = await addPackages(
    root,
    groups.map((item) => item.spec),
    { ...options, features },
  );
  const withFeatures = featuresText(names, report, "; ");
  print(`Añadido ${names.join(", ")}.${withFeatures ? ` Features: ${withFeatures}.` : ""}\n${summarize(report)}`);
  if (needsGrant.length)
    print(
      `Contiene herramientas ejecutables no autorizadas todavía. Revisa y autoriza con: ${needsGrant.map((name) => `modai permissions grant ${name}`).join("; ")}`,
    );
}

export function registerAdd(program: Command, print: Print): void {
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
    .action(async (_specs: string[], options: AddFlags, command: Command) => {
      const groups = splitPackageFlags(command.args.filter((token) => token !== "-h"));
      if (options.help || command.args.includes("-h")) return showHelp(groups, command, print);
      return add(groups, options, print);
    });
}
