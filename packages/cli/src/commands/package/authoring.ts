import { resolve } from "node:path";
import { analyzePackageQuality } from "@modai/contracts/quality";
import { parseInput, publishSchema } from "@modai/contracts/schemas";
import { loadPackageSource, validatePackage } from "@modai/core";
import type { Command } from "commander";
import { type ScaffoldOptions, scaffoldPackage } from "../../authoring/package-scaffold.js";
import { generateSigningKey } from "../../authoring/signing.js";
import type { Print } from "../../terminal/output.js";

export function registerPackageScaffold(pkg: Command, print: Print): void {
  pkg
    .command("scaffold")
    .description("Crea un paquete con la especificación v1")
    .argument("<directory>")
    .requiredOption("--name <name>", "@scope/name")
    .option("--kind <kind>", "package, profile o adapter", "package")
    .option("--category <category>", "Categoría informativa: frontend, testing, iot... (el Core no la interpreta)")
    .option("--with-tool", "Incluye una herramienta ejecutable de ejemplo")
    .action((directory: string, options: ScaffoldOptions) =>
      print(
        `Paquete creado en ${scaffoldPackage(directory, options)}\nValida con: modai package validate ${directory}`,
      ),
    );
}

export function registerPackageValidate(pkg: Command, print: Print): void {
  pkg
    .command("validate")
    .argument("[directory]", "Carpeta del paquete", ".")
    .description("Valida el paquete y evalúa su calidad estructural")
    .action((directory: string) => {
      const input = loadPackageSource(resolve(directory));
      parseInput(publishSchema, input);
      validatePackage(input.manifest, input.files);
      const quality = analyzePackageQuality(input.manifest, input.files);
      print({
        score: `${quality.score}/100`,
        dimensions: quality.dimensions,
        findings: quality.findings.map((item) => ({ severity: item.severity, code: item.code, message: item.message })),
      });
      if (quality.findings.some((item) => item.severity === "error")) process.exitCode = 1;
    });
}

export function registerPackageKeygen(pkg: Command, print: Print): void {
  pkg
    .command("keygen")
    .argument("[directory]", "Carpeta de salida", ".modai/keys")
    .description("Genera un par de claves Ed25519 para firmar paquetes")
    .action((directory: string) => print(generateSigningKey(directory)));
}
