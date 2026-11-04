import { resolve } from "node:path";
import { loadV1Project } from "@modai/core";
import type { Command } from "commander";
import { featureChoices, type PackageFlags, splitPackageFlags } from "../../services/features.js";
import { addPackages, featuresText, parseSpec } from "../../services/packages.js";
import { projectRegistry } from "../../services/registries.js";
import type { DiscoveredProject } from "../../services/workspace.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";
import { type Action, type Outcome, type RunOptions, runOnProjects, withRunOptions } from "./run-on-projects.js";

type AddOptions = RunOptions & { allow?: string[] };

function absoluteSpecs(groups: PackageFlags[]): PackageFlags[] {
  return groups.map((item) => ({
    ...item,
    spec: /^(file:|\.\.?\/|\/)/.test(item.spec) ? `file:${resolve(item.spec.replace(/^file:/, ""))}` : item.spec,
  }));
}

function addAction(groups: PackageFlags[], options: AddOptions): Action {
  const specs = groups.map((item) => item.spec);
  const flagsText = groups
    .filter((item) => item.flags.length)
    .map((item) => `${item.spec} ${item.flags.join(" ")}`)
    .join("; ");
  const plan = async (project: DiscoveredProject): Promise<Outcome> => {
    const loaded = loadV1Project(project.root);
    const missing = specs
      .map((spec) => parseSpec(spec, project.root))
      .filter((item) => !(item.name in loaded.file.dependencies));
    if (!missing.length) return { project: project.path, result: "sin cambios", detail: "ya está instalado" };
    const registry = projectRegistry(loaded);
    for (const item of missing)
      if (!item.value.startsWith("file:") && !(await registry.versions(item.name)).length)
        throw new Error(`${item.name} no existe en sus registries`);
    await featureChoices(groups, project.root);
    return {
      project: project.path,
      result: "pendiente",
      detail: `añadirá ${missing.map((item) => item.name).join(", ")}`,
    };
  };
  const apply = async (project: DiscoveredProject): Promise<string> => {
    const loaded = loadV1Project(project.root);
    const missing = specs.filter((spec) => !(parseSpec(spec, project.root).name in loaded.file.dependencies));
    const { names, needsGrant, report } = await addPackages(project.root, missing, {
      allow: options.allow,
      features: await featureChoices(groups, project.root),
    });
    const withFeatures = featuresText(names, report, "; ");
    return `añadido ${names.join(", ")}${withFeatures ? ` · features: ${withFeatures}` : ""}${needsGrant.length ? ` · requiere modai permissions grant ${needsGrant.join(", ")}` : ""}`;
  };
  return { describe: `Añadir ${specs.join(", ")}${flagsText ? ` (${flagsText})` : ""}`, plan, apply };
}

export function registerWorkspaceAdd(workspace: Command, print: Print): void {
  withRunOptions(
    workspace
      .command("add")
      .argument("<packages...>", "@scope/nombre[@rango], cada uno seguido de sus flags (--tls, --no-metrics)")
      .description("Añade paquetes en todos los proyectos encontrados, con las mismas features en todos"),
  )
    .option("--allow <permissions>", "Permisos de instalación concedidos en cada proyecto", commaList)
    .allowUnknownOption()
    .action(async (_specs: string[], options: AddOptions, command: Command) => {
      const groups = absoluteSpecs(splitPackageFlags(command.args));
      await runOnProjects(addAction(groups, options), options, print);
    });
}
