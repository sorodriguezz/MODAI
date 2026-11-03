import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import type { Command } from "commander";
import { ApiClient } from "@modai/sdk";
import { assertSafeRelativePath, sha256 } from "@modai/contracts/security";
import type { ArtifactFile } from "@modai/contracts/types";
import { safeProjectPath, writeZip } from "@modai/core";
import { effectiveConnection } from "../connection.js";
import { group } from "../groups.js";
import type { Print } from "../output.js";

const serverApi = () => { const connection = effectiveConnection(); return new ApiClient(connection.server, connection.token); };
/** Same exclusions as the server: dependencies, build output, VCS data and local secrets. */
const EXCLUDED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.turbo|\.modai\/store|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/;
const TEXT = /\.(md|mdx|txt|json|jsonc|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|css|scss|html|xml|sh|ps1|py|java|kt|go|rs|env\.example|gitignore|dockerignore|editorconfig|properties|gradle|sql|graphql|prisma|vue|svelte)$|(^|\/)(Dockerfile|Makefile|README|LICENSE|\.gitignore|\.npmrc|\.nvmrc)$/i;

function collect(root: string, relative = ""): ArtifactFile[] {
  const absolute = relative ? join(root, relative) : root;
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || (relative && EXCLUDED.test(relative))) return [];
  if (info.isFile()) { const bytes = readFileSync(absolute); return [{ path: relative, content: bytes.toString("base64"), sha256: sha256(bytes) }]; }
  if (!info.isDirectory()) return [];
  return readdirSync(absolute).sort().flatMap(name => collect(root, relative ? posix.join(relative, name) : name));
}

function splitSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  return at > spec.indexOf("/") ? { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined } : { name: spec };
}

/** `{{name}}` placeholders in paths and text files. Unknown placeholders are left untouched. */
export function applyVariables(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z][\w-]*)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
}

export function registerTemplateCommands(program: Command, print: Print): void {
  const template = group(program, "template", "Templates de proyecto versionados (por ejemplo NestJS con SDD)");
  template.command("list").alias("ls").description("Templates publicados en el servidor").argument("[query]", "Filtra por nombre, stack o etiqueta")
    .action(async (query?: string) => print((await serverApi().templates(query)).map(item => ({ name: item.name, version: item.version, stack: item.stack ?? "—", versions: item.versions, description: item.description }))));

  template.command("publish").description("Publica una carpeta o un .zip como versión inmutable de un template")
    .argument("<source>", "Carpeta del proyecto modelo o archivo .zip")
    .requiredOption("--name <@scope/name@version>", "Nombre y versión del template, por ejemplo @equipo/nestjs-sdd@1.0.0")
    .requiredOption("--description <text>", "Qué incluye y para qué sirve")
    .option("--stack <text>", "Tecnologías, por ejemplo \"NestJS 11 · SDD · PostgreSQL\"")
    .option("--tags <tags>", "Etiquetas separadas por comas", (value: string) => value.split(",").map(tag => tag.trim()).filter(Boolean))
    .action(async (source: string, options: { name: string; description: string; stack?: string; tags?: string[] }) => {
      const { name, version } = splitSpec(options.name);
      if (!version) throw new Error("Indica la versión en --name, por ejemplo @equipo/nestjs-sdd@1.0.0");
      const path = resolve(source);
      const files = statSync(path).isDirectory() ? collect(path) : undefined;
      const content = files ? { files } : { archive: readFileSync(path).toString("base64") };
      if (files && !files.length) throw new Error("La carpeta no tiene archivos publicables (se excluyen node_modules, .git, dist y .env)");
      const published = await serverApi().publishTemplate({ name, version, description: options.description, stack: options.stack, tags: options.tags, ...content });
      print(`Publicado el template ${published.name}@${published.version}: ${published.files} archivos. Úsalo con: modai template use ${published.name} ./mi-proyecto`);
    });

  template.command("use").description("Crea un proyecto nuevo a partir de un template")
    .argument("<template>", "@scope/nombre[@versión]")
    .argument("[directory]", "Carpeta destino", ".")
    .option("--var <key=value...>", "Valores para los marcadores {{clave}} (projectName se deduce de la carpeta)")
    .option("--force", "Escribe aunque la carpeta no esté vacía (sobrescribe archivos con el mismo nombre)")
    .action(async (spec: string, directory: string, options: { var?: string[]; force?: boolean }) => {
      const { name, version } = splitSpec(spec);
      const target = resolve(directory);
      if (existsSync(target) && readdirSync(target).length && !options.force) throw new Error(`${target} no está vacía. Usa otra carpeta o --force.`);
      const variables: Record<string, string> = { projectName: basename(target) };
      for (const pair of options.var ?? []) {
        const index = pair.indexOf("=");
        if (index < 1) throw new Error(`Variable inválida: ${pair}. Usa clave=valor.`);
        variables[pair.slice(0, index)] = pair.slice(index + 1);
      }
      const { template: record, files } = await serverApi().templateFiles(name, version);
      mkdirSync(target, { recursive: true });
      for (const file of files) {
        const relative = applyVariables(file.path, variables);
        assertSafeRelativePath(relative, "path");
        const destination = safeProjectPath(target, relative);
        mkdirSync(dirname(destination), { recursive: true });
        const bytes = Buffer.from(file.content, "base64");
        writeFileSync(destination, TEXT.test(relative) ? applyVariables(bytes.toString("utf8"), variables) : bytes);
      }
      print(`Proyecto creado en ${target} desde ${record.name}@${record.version} (${files.length} archivos).`);
    });

  template.command("info").description("Versiones, estado y archivos de un template")
    .argument("<template>", "@scope/nombre[@versión]")
    .action(async (spec: string) => {
      const { name, version } = splitSpec(spec);
      const info = await serverApi().templateInfo(name, version);
      print({ name: info.template.name, version: info.template.version, description: info.template.description, stack: info.template.stack ?? "—", tags: info.template.tags,
        versions: info.versions.map(item => `${item.version}${item.status === "yanked" ? " (retirada)" : ""}`), files: info.files.map(item => item.path) });
    });
  for (const [command, status, label] of [["yank", "yanked", "Retirada"], ["restore", "active", "Restaurada"]] as const) {
    template.command(command).description(status === "yanked" ? "Retira una versión: deja de ser la última, pero sigue disponible por versión exacta" : "Vuelve a activar una versión retirada")
      .argument("<template>", "@scope/nombre@versión")
      .action(async (spec: string) => {
        const { name, version } = splitSpec(spec);
        if (!version) throw new Error("Indica la versión: @scope/nombre@1.0.0");
        const updated = await serverApi().setTemplateStatus(name, version, status);
        print(`${label} ${updated.name}@${updated.version}.`);
      });
  }

  template.command("download").description("Descarga un template como .zip sin aplicar variables")
    .argument("<template>", "@scope/nombre[@versión]")
    .argument("[file]", "Archivo destino")
    .action(async (spec: string, file?: string) => {
      const { name, version } = splitSpec(spec);
      const { template: record, files } = await serverApi().templateFiles(name, version);
      const folder = record.name.split("/")[1]!;
      const output = resolve(file ?? `${folder}-${record.version}.zip`);
      writeFileSync(output, writeZip(files.map(item => ({ path: `${folder}/${item.path}`, bytes: Buffer.from(item.content, "base64") }))));
      print(`Descargado ${record.name}@${record.version} en ${output}`);
    });
}
