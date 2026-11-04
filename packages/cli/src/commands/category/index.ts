import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { group } from "../../terminal/help-sections.js";
import type { Print } from "../../terminal/output.js";
import { askText, hint, ok } from "../../terminal/prompts.js";

async function askName(): Promise<string> {
  return askText({
    message: "Nombre de la categoría",
    flag: "<name>",
    example: "observabilidad",
    validate: (value) => /^[a-z][a-z0-9-]{0,63}$/.test(value) || "Minúsculas, números y guiones, empezando por letra",
  });
}

function registerCategoryList(category: Command, print: Print): void {
  category
    .command("list", { isDefault: true })
    .alias("ls")
    .description("Categorías registradas y las que usan paquetes sin estar registradas")
    .action(async () =>
      print(
        (await serverApi().categories()).map((item) => ({
          name: item.name,
          registered: item.registered,
          packages: item.packages,
          description: item.description,
        })),
      ),
    );
}

function registerCategoryCreate(category: Command, print: Print): void {
  category
    .command("create")
    .description("Registra una categoría (administración)")
    .argument("[name]", "En minúsculas, con guiones: backend, testing… (sin él, se pregunta)")
    .option("--description <text>", "Qué tipo de paquetes van en ella")
    .action(async (name: string | undefined, options: { description?: string }) => {
      const chosen = name ?? (await askName());
      const description =
        options.description ??
        (name
          ? undefined
          : await askText({ message: `Descripción ${hint("(opcional)")}`, flag: "--description", default: "" }));
      const created = await serverApi().createCategory({ name: chosen, description });
      print(ok(`Categoría ${created.name} registrada.`));
    });
}

function registerCategoryUpdate(category: Command, print: Print): void {
  category
    .command("update")
    .description("Cambia la descripción de una categoría (administración)")
    .argument("<name>")
    .requiredOption("--description <text>")
    .action(async (name: string, options: { description: string }) => {
      await serverApi().updateCategory(name, { description: options.description });
      print(`Categoría ${name} actualizada.`);
    });
}

function registerCategoryDelete(category: Command, print: Print): void {
  category
    .command("delete")
    .alias("rm")
    .description("Deja de ofrecer una categoría; los paquetes publicados la conservan (administración)")
    .argument("<name>")
    .action(async (name: string) => {
      await serverApi().deleteCategory(name);
      print(`Categoría ${name} eliminada.`);
    });
}

export function registerCategoryCommands(program: Command, print: Print): void {
  const category = group(
    program,
    "category",
    "Categorías del catálogo: las que el panel ofrece al crear paquetes y templates",
  );
  registerCategoryList(category, print);
  registerCategoryCreate(category, print);
  registerCategoryUpdate(category, print);
  registerCategoryDelete(category, print);
}
