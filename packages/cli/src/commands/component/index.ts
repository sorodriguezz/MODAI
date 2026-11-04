import type { Command } from "commander";
import { type ComponentOptions, createComponentPackage } from "../../authoring/component-package.js";
import type { EntryOptions } from "../../services/catalog.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";
import { listInstalled } from "../project/list.js";

function registerComponentCreate(component: Command, print: Print): void {
  component
    .command("create")
    .argument("<directory>", "Carpeta del nuevo paquete")
    .description("Empaqueta código existente (--from) o crea un esqueleto como componente instalable")
    .requiredOption("--name <name>", "@scope/nombre")
    .option("--from <directory>", "Carpeta con el código que quieres reutilizar")
    .option(
      "--target <path>",
      "Destino en el proyecto que lo instale; admite {component} y {package}",
      "src/modules/{component}",
    )
    .option("--component <name>", "Nombre del componente (por defecto, el de la carpeta --from)")
    .option("--description <text>")
    .option("--version <semver>", "Versión inicial", "0.1.0")
    .option("--language <language>", "Lenguaje o framework informativo: typescript, nestjs, python…")
    .option("--category <category>", "Categoría informativa", "component")
    .option("--tags <tags>", "Etiquetas separadas por comas", commaList)
    .action((directory: string, options: ComponentOptions) => {
      const created = createComponentPackage(directory, options);
      print(
        `Componente creado en ${created}\nValida:   modai package validate ${directory}\nPublica:  modai package publish ${directory} --registry <registry>\nInstala:  modai add ${options.name} --allow project.source`,
      );
    });
}

export function registerComponentCommands(program: Command, print: Print): void {
  const component = program
    .command("component")
    .description("Componentes de código reutilizables (módulos de backend, componentes de UI, servicios…)");
  registerComponentCreate(component, print);
  component
    .command("list")
    .description("Componentes instalados (o --available)")
    .option("--available")
    .option("--registry <name|url|path>")
    .option("--query <text>")
    .action((options: EntryOptions) => listInstalled("components", options));
}
