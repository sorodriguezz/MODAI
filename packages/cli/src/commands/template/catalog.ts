import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeZip } from "@modai/core";
import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { splitVersionSpec } from "../../services/package-spec.js";
import { verifiedTemplate } from "../../services/templates.js";
import { installationPolicy } from "../../services/trust.js";
import type { Print } from "../../terminal/output.js";

export function registerTemplateList(template: Command, print: Print): void {
  template
    .command("list")
    .alias("ls")
    .description("Templates publicados en el servidor")
    .argument("[query]", "Filtra por nombre, categoría o etiqueta")
    .action(async (query?: string) =>
      print(
        (await serverApi().templates(query)).map((item) => ({
          name: item.name,
          version: item.version,
          category: item.manifest.spec?.category ?? "template",
          versions: item.versions,
          description: item.description,
        })),
      ),
    );
}

const statusLabel = (status: string) =>
  status === "yanked" ? " (retirada)" : status === "deprecated" ? " (deprecada)" : "";

export function registerTemplateInfo(template: Command, print: Print): void {
  template
    .command("info")
    .description("Versiones, features y archivos de un template")
    .argument("<template>", "@scope/nombre[@versión]")
    .action(async (spec: string) => {
      const { name, version } = splitVersionSpec(spec);
      const api = serverApi();
      const info = await api.templateInfo(name, version);
      const versions = (await api.listPackages(name, true))
        .filter((item) => item.name === name)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      print({
        name: info.package.name,
        version: info.package.version,
        description: info.package.description,
        category: info.package.manifest.spec?.category ?? "template",
        tags: info.package.manifest.metadata?.keywords ?? [],
        versions: versions.map((item) => `${item.version}${statusLabel(item.status)}`),
        ...(info.features?.length
          ? {
              features: info.features.map(
                (item) => `--${item.name}${item.default ? " (por defecto)" : ""}: ${item.description}`,
              ),
            }
          : {}),
        ...(info.addon ? { addon: `para ${info.addon.for.join(", ") || "cualquier template"}` } : {}),
        files: info.files.map((item) => item.path),
      });
    });
}

export function registerTemplateDownload(template: Command, print: Print): void {
  template
    .command("download")
    .description("Descarga un template como .zip sin aplicar variables")
    .argument("<template>", "@scope/nombre[@versión]")
    .argument("[file]", "Archivo destino")
    .action(async (spec: string, file?: string) => {
      const { name, version } = splitVersionSpec(spec);
      const api = serverApi();
      const { template: record, files } = await verifiedTemplate(api, name, version, await installationPolicy(api));
      const folder = record.name.split("/")[1]!;
      const output = resolve(file ?? `${folder}-${record.version}.zip`);
      writeFileSync(
        output,
        writeZip(files.map((item) => ({ path: `${folder}/${item.path}`, bytes: Buffer.from(item.content, "base64") }))),
      );
      print(`Descargado ${record.name}@${record.version} en ${output}`);
    });
}
