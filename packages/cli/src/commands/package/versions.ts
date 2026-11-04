import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeZip } from "@modai/core";
import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { exactVersion, splitPackageSpec } from "../../services/package-spec.js";
import { isJsonMode, type Print } from "../../terminal/output.js";

export function registerPackageUsage(pkg: Command, print: Print): void {
  pkg
    .command("usage")
    .description("Proyectos vinculados a este servidor que usan un paquete, con su versión")
    .argument("<package>", "@scope/nombre")
    .action(async (spec: string) => {
      const { name } = splitPackageSpec(spec);
      const projects = await serverApi().packageUsage(name);
      print(
        projects.length || isJsonMode()
          ? projects.map((item) => ({
              project: item.projectName,
              id: item.projectId,
              version: item.version,
              how: item.direct ? "directa" : "dependencia",
              reported: item.reportedAt,
            }))
          : `Ningún proyecto que puedas ver informa usar ${name} (los proyectos lo informan al sincronizar con modai init --project).`,
      );
    });
}

export function registerPackageDownload(pkg: Command, print: Print): void {
  pkg
    .command("download")
    .description("Descarga una versión publicada como .zip (sus archivos tal cual)")
    .argument("<package>", "@scope/nombre[@versión]")
    .argument("[file]", "Archivo destino")
    .action(async (spec: string, file?: string) => {
      const { name, range } = splitPackageSpec(spec);
      const api = serverApi();
      const item = await api.getPackage(name, range === "*" ? undefined : range);
      const { files } = await api.artifact(item.artifactId);
      const folder = item.name.split("/")[1]!;
      const output = resolve(file ?? `${folder}-${item.version}.zip`);
      writeFileSync(
        output,
        writeZip(
          files.map((entry) => ({ path: `${folder}/${entry.path}`, bytes: Buffer.from(entry.content, "base64") })),
        ),
      );
      print(`Descargado ${item.name}@${item.version} en ${output}`);
    });
}

export function registerPackageDeprecate(pkg: Command, print: Print): void {
  pkg
    .command("deprecate")
    .description("Marca una versión como deprecada")
    .argument("<package>", "@scope/nombre@versión")
    .requiredOption("--message <message>")
    .action(async (spec: string, options: { message: string }) => {
      const item = exactVersion(spec);
      await serverApi().deprecate(item.name, item.version, options.message);
      print(`Deprecada ${item.name}@${item.version}.`);
    });
}

export function registerPackageYank(pkg: Command, print: Print): void {
  pkg
    .command("yank")
    .description("Retira una versión de nuevas resoluciones")
    .argument("<package>", "@scope/nombre@versión")
    .requiredOption("--reason <reason>")
    .action(async (spec: string, options: { reason: string }) => {
      const item = exactVersion(spec);
      await serverApi().yank(item.name, item.version, options.reason);
      print(`Retirada ${item.name}@${item.version}: ya no se resuelve en instalaciones nuevas.`);
    });
}

export function registerPackageUnpublish(pkg: Command, print: Print): void {
  pkg
    .command("unpublish")
    .description("Elimina definitivamente una versión previamente retirada")
    .argument("<package>", "@scope/nombre@versión")
    .option("--confirm", "Confirma la eliminación irreversible")
    .action(async (spec: string, options: { confirm?: boolean }) => {
      if (!options.confirm)
        throw new Error("Operación irreversible: repite con --confirm después de ejecutar modai package yank.");
      const item = exactVersion(spec);
      await serverApi().hardDelete(item.name, item.version);
      print(`Eliminado definitivamente ${item.name}@${item.version}.`);
    });
}
