import type { Command } from "commander";
import { defineFeature, type FeatureDefinition, undefineFeature } from "../../authoring/feature-definition.js";
import { commaList, repeatable } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";
import { askText } from "../../terminal/prompts.js";

export function registerFeatureDefine(feature: Command, print: Print): void {
  feature
    .command("define")
    .description(
      "Crea o reemplaza una feature en la carpeta de un paquete (modai.package.yaml) o de un template (modai.template.yaml)",
    )
    .argument("<directory>", "Carpeta del paquete o del template")
    .argument("<name>", "Nombre de la feature: se activa con --<nombre>")
    .option("--description <text>", "Qué hace (lo que se ve en --help); sin ella, se pregunta")
    .option(
      "--path <folder>",
      "Carpeta con sus archivos: en un template se copian sobre el proyecto; en un paquete se añaden al componente",
    )
    .option("--component <name>", "Paquete con varios componentes: a cuál se añaden los archivos de --path")
    .option("--default", "Activada salvo --no-<nombre>")
    .option("--requires <features>", "Features que activa también (separadas por comas)", commaList)
    .option("--conflicts <features>", "Features con las que no se combina (separadas por comas)", commaList)
    .option("--package <@scope/nombre@rango>", "Paquete que añade mientras está activa (repetible)", repeatable)
    .option("--var <clave=valor>", "Solo templates: valor de un marcador {{clave}} (repetible)", repeatable)
    .option("--uses <@scope/nombre[@versión]>", "Solo templates: add-on que se aplica antes de la carpeta")
    .action(async (directory: string, name: string, options: FeatureDefinition) => {
      options.description ??= await askText({
        message: `¿Qué hace --${name}?`,
        flag: "--description",
        example: "Añade Spec-Driven Development (specs/ y plantillas)",
      });
      const { file, isPackage } = defineFeature(directory, name, options);
      print(
        `Feature --${name} definida en ${file}.${isPackage ? `\nValida el paquete: modai package validate ${directory}` : `\nPruébala: modai template use <template> --${name} --dry-run (tras publicar)`}`,
      );
    });
}

export function registerFeatureUndefine(feature: Command, print: Print): void {
  feature
    .command("undefine")
    .description("Quita una feature de la carpeta de un paquete o de un template")
    .argument("<directory>", "Carpeta del paquete o del template")
    .argument("<name>", "Nombre de la feature")
    .action((directory: string, name: string) => {
      const file = undefineFeature(directory, name);
      print(`Feature --${name} quitada de ${file}. Revisa las que la requerían o se oponían a ella.`);
    });
}
