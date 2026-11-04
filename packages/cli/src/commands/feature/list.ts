import { loadV1Project, packageFeatureRules, type V1Project } from "@modai/core";
import type { Command } from "commander";
import { installedManifest, manifestForSpec } from "../../services/features.js";
import { parseSpec } from "../../services/packages.js";
import { currentProject, requireProject } from "../../services/project.js";
import type { Print } from "../../terminal/output.js";
import { packageHelp } from "../../terminal/package-help.js";

function choiceLabel(project: V1Project, name: string, feature: string): string {
  const value = project.file.features[name]?.[feature];
  if (value === undefined) return "por defecto";
  return value ? "activada" : "quitada";
}

function featureRows(project: V1Project, names: string[]) {
  return names.flatMap((name) => {
    const { manifest, active } = installedManifest(project.root, name);
    return packageFeatureRules(manifest).map((rule) => ({
      package: name,
      feature: rule.name,
      active: active.includes(rule.name),
      default: rule.default,
      choice: choiceLabel(project, name, rule.name),
      description: rule.description,
    }));
  });
}

export function registerFeatureList(feature: Command, print: Print): void {
  feature
    .command("list", { isDefault: true })
    .alias("ls")
    .description("Features de los paquetes del proyecto (o de un paquete, instalado o no)")
    .argument("[package]", "@scope/nombre[@rango]")
    .action(async (spec?: string) => {
      const root = process.cwd();
      if (spec && !currentProject(root)?.lock.packages[parseSpec(spec, root).name]) {
        print(packageHelp(await manifestForSpec(spec, root)));
        return;
      }
      const project = loadV1Project(requireProject());
      const names = spec ? [parseSpec(spec, root).name] : Object.keys(project.lock.packages);
      const rows = featureRows(project, names);
      print(
        rows.length ? rows : spec ? `${names[0]} no declara features.` : "Ningún paquete instalado declara features.",
      );
    });
}
