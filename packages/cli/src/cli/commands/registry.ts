import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import semver from "semver";
import { ApiClient } from "@modai/sdk";
import { isV1Project, loadPackageSource, loadV1Project, validatePackage } from "@modai/core";
import { publishV1 } from "../../v1/commands.js";
import { listV1 } from "../../v1/list.js";
import { registryFromArgument, registrySource, requireV1Project, runSync, summarize } from "../../v1/runtime.js";
import { effectiveConnection } from "../connection.js";
import { signPackage } from "../package-authoring.js";
import { group } from "../groups.js";
import type { Print } from "../output.js";

export function splitPackageSpec(spec: string): { name: string; range: string } {
  const separator = spec.lastIndexOf("@");
  if (!spec.startsWith("@") || !spec.includes("/")) throw new Error(`Paquete inválido: ${spec}. Usa @scope/nombre[@rango].`);
  if (separator > spec.indexOf("/")) return { name: spec.slice(0, separator), range: spec.slice(separator + 1) || "*" };
  return { name: spec, range: "*" };
}

function exactVersion(spec: string): { name: string; version: string } {
  const item = splitPackageSpec(spec);
  if (!semver.valid(item.range)) throw new Error("Indica una versión exacta: @scope/nombre@1.2.3");
  return { name: item.name, version: item.range };
}

const serverApi = () => { const connection = effectiveConnection(); return new ApiClient(connection.server, connection.token); };

/** Registries of the project, plus publishing and the lifecycle of published versions (under `modai package`). */
export function registerRegistryCommands(program: Command, print: Print): void {
  const registry = program.command("registry").description("Registries del proyecto y búsqueda de paquetes");
  registry.command("list").description("Registries configurados en modai.yaml").action(() => listV1("registries", {}, print));
  registry.command("add").argument("<name>").argument("<url-or-path>").description("Añade un registry (URL de servidor MODAI o carpeta local)").action(async (name: string, value: string) => {
    const root = requireV1Project();
    const { report } = await runSync(root, file => { if (file.registries.some(item => item.name === name)) throw new Error(`Ya existe el registry ${name}`); file.registries.push(registrySource(name, value, root)); });
    print(`Registry ${name} añadido.\n${summarize(report)}`);
  });
  registry.command("remove").argument("<name>").action(async (name: string) => {
    const { report } = await runSync(requireV1Project(), file => { file.registries = file.registries.filter(item => item.name !== name); });
    print(`Registry ${name} retirado.\n${summarize(report)}`);
  });
  registry.command("packages").description("Paquetes publicados (equivale a modai list --available)")
    .option("--query <text>", "Filtro de texto").option("--registry <url|path>", "Registry concreto")
    .action(options => listV1("packages", { ...options, available: true }, print));

  const pkg = group(program, "package", "Crear, validar, publicar y retirar paquetes");
  pkg.command("publish")
    .description("Publica un paquete inmutable en un registry (servidor MODAI o carpeta local)")
    .argument("[directory]", "Carpeta del paquete", ".")
    .option("--key <private-key>", "Firma el paquete con una clave privada Ed25519")
    .option("--registry <name|url|path>", "Registry destino; por defecto el servidor conectado")
    .action(async (directory: string, options: { key?: string; registry?: string }) => {
      let input = loadPackageSource(resolve(directory));
      validatePackage(input.manifest, input.files);
      if (options.key) input = signPackage(input, readFileSync(resolve(options.key), "utf8"));
      if (options.registry) return publishV1(resolve(directory), registryFromArgument(options.registry, isV1Project(process.cwd()) ? loadV1Project() : undefined), input, print);
      const published = await serverApi().publish(input);
      print(`Publicado ${published.name}@${published.version}, calidad ${published.quality?.score ?? "—"}/100${published.signerFingerprint ? ", firmado" : ""}.`);
    });

  pkg.command("deprecate").description("Marca una versión como deprecada").argument("<package>", "@scope/nombre@versión").requiredOption("--message <message>")
    .action(async (spec: string, options: { message: string }) => { const item = exactVersion(spec); await serverApi().deprecate(item.name, item.version, options.message); print(`Deprecada ${item.name}@${item.version}.`); });
  pkg.command("yank").description("Retira una versión de nuevas resoluciones").argument("<package>", "@scope/nombre@versión").requiredOption("--reason <reason>")
    .action(async (spec: string, options: { reason: string }) => { const item = exactVersion(spec); await serverApi().yank(item.name, item.version, options.reason); print(`Retirada ${item.name}@${item.version}: ya no se resuelve en instalaciones nuevas.`); });
  pkg.command("unpublish").description("Elimina definitivamente una versión previamente retirada").argument("<package>", "@scope/nombre@versión").option("--confirm", "Confirma la eliminación irreversible")
    .action(async (spec: string, options: { confirm?: boolean }) => {
      if (!options.confirm) throw new Error("Operación irreversible: repite con --confirm después de ejecutar modai package yank.");
      const item = exactVersion(spec);
      await serverApi().hardDelete(item.name, item.version);
      print(`Eliminado definitivamente ${item.name}@${item.version}.`);
    });
}
