import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { TEMPLATE_MANIFEST } from "@modai/core";
import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { splitVersionSpec } from "../../services/package-spec.js";
import { collectTemplateFiles } from "../../services/templates.js";
import { splitList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

const SKELETON: Record<string, string> = {
  "README.md": "# {{projectName}}\n\nQué es este proyecto, cómo se instala y cómo se ejecuta.\n",
  "AGENTS.md":
    "# Instrucciones para agentes de {{projectName}}\n\nConvenciones, comandos de verificación y límites del proyecto.\n",
  ".gitignore": "node_modules/\ndist/\n.env\n.modai/store/\n",
  [TEMPLATE_MANIFEST]: [
    "# Opciones de este template: se activan con flags al usarlo (modai template use <template> --sdd).",
    '# Añádelas con: modai feature define . sdd --description "Spec-Driven Development" --path features/sdd',
    "# Guía completa: docs/guides/TEMPLATES.md",
    "features: {}",
    "",
  ].join("\n"),
};

export function registerTemplateInit(template: Command, print: Print): void {
  template
    .command("init")
    .description("Crea el esqueleto de un template: README, AGENTS.md y un modai.template.yaml comentado")
    .argument("<directory>", "Carpeta nueva del template")
    .action((directory: string) => {
      const root = resolve(directory);
      if (existsSync(root) && readdirSync(root).length) throw new Error(`${root} no está vacía`);
      for (const [path, content] of Object.entries(SKELETON)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content, { flag: "wx" });
      }
      print(
        `Template creado en ${root}.\nOpciones:  modai feature define ${directory} <nombre> --description "…" --path features/<nombre>\nPublica:   modai template publish ${directory} --name @equipo/nombre@1.0.0 --description "…"`,
      );
    });
}

type PublishOptions = { name: string; description: string; category?: string; tags?: string[] };

export function registerTemplatePublish(template: Command, print: Print): void {
  template
    .command("publish")
    .description("Publica una carpeta o un .zip como versión inmutable de un template (un paquete kind: Template)")
    .argument("<source>", "Carpeta del proyecto modelo o archivo .zip")
    .requiredOption(
      "--name <@scope/name@version>",
      "Nombre y versión del template, por ejemplo @equipo/nestjs-sdd@1.0.0",
    )
    .requiredOption("--description <text>", "Qué incluye y para qué sirve")
    .option("--category <category>", "Categoría del catálogo (por defecto template), por ejemplo backend")
    .option("--tags <tags>", "Etiquetas separadas por comas (tecnologías, por ejemplo nestjs,postgres)", splitList)
    .action(async (source: string, options: PublishOptions) => {
      const { name, version } = splitVersionSpec(options.name);
      if (!version) throw new Error("Indica la versión en --name, por ejemplo @equipo/nestjs-sdd@1.0.0");
      const path = resolve(source);
      const files = statSync(path).isDirectory() ? collectTemplateFiles(path) : undefined;
      const content = files ? { files } : { archive: readFileSync(path).toString("base64") };
      if (files && !files.length)
        throw new Error("La carpeta no tiene archivos publicables (se excluyen node_modules, .git, dist y .env)");
      const published = await serverApi().importTemplate({
        name,
        version,
        description: options.description,
        category: options.category,
        keywords: options.tags,
        ...content,
      });
      print(
        `Publicado el template ${published.name}@${published.version}. Úsalo con: modai template use ${published.name} ./mi-proyecto`,
      );
    });
}
