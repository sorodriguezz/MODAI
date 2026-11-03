import { resolve } from "node:path";
import type { Command } from "commander";
import { analyzePackageQuality } from "@modai/contracts/package-quality";
import { parseInput, publishSchema } from "@modai/contracts/schemas";
import { loadPackageSource, validatePackage } from "@modai/core";
import { scaffoldV1 } from "../../v1/commands.js";
import { auditHarness, createHarness } from "../harness-tools.js";
import { generateSigningKey } from "../package-authoring.js";
import type { Print } from "../output.js";

/** Creating, validating and signing packages and harnesses. */
export function registerAuthoringCommands(program: Command, print: Print): void {
  const pkg = program.command("package").description("Herramientas de autoría de paquetes");
  pkg.command("scaffold")
    .description("Crea un paquete con la especificación v1")
    .argument("<directory>")
    .requiredOption("--name <name>", "@scope/name")
    .option("--kind <kind>", "package, profile o adapter", "package")
    .option("--category <category>", "Categoría informativa: frontend, testing, iot... (el Core no la interpreta)")
    .option("--with-tool", "Incluye una herramienta ejecutable de ejemplo")
    .action((directory: string, options) => print(`Paquete creado en ${scaffoldV1(directory, options)}\nValida con: modai package validate ${directory}`));
  pkg.command("validate").argument("[directory]", "Carpeta del paquete", ".").description("Valida el paquete y evalúa su calidad estructural")
    .action((directory: string) => {
      const input = loadPackageSource(resolve(directory));
      parseInput(publishSchema, input);
      validatePackage(input.manifest, input.files);
      const quality = analyzePackageQuality(input.manifest, input.files);
      print({ score: `${quality.score}/100`, dimensions: quality.dimensions, findings: quality.findings.map(item => ({ severity: item.severity, code: item.code, message: item.message })) });
      if (quality.findings.some(item => item.severity === "error")) process.exitCode = 1;
    });
  pkg.command("keygen").argument("[directory]", "Carpeta de salida", ".modai/keys").description("Genera un par de claves Ed25519 para firmar paquetes")
    .action((directory: string) => print(generateSigningKey(directory)));

  const harness = program.command("harness").description("Crea y audita harnesses de cinco subsistemas");
  harness.command("init").argument("[directory]", "Proyecto", ".")
    .option("--agent-file <name>", "AGENTS.md o CLAUDE.md", "AGENTS.md")
    .option("--force", "Reemplaza artefactos existentes")
    .action((directory: string, options: { agentFile: string; force?: boolean }) => print({ created: createHarness(directory, options.agentFile, options.force ?? false) }));
  harness.command("audit").argument("[directory]", "Proyecto", ".").action((directory: string) => print(auditHarness(directory)));
}
