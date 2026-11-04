import type { Command } from "commander";
import { auditHarness, createHarness } from "../../authoring/harness.js";
import type { Print } from "../../terminal/output.js";

export function registerHarnessCommands(program: Command, print: Print): void {
  const harness = program.command("harness").description("Crea y audita harnesses de cinco subsistemas");
  harness
    .command("init")
    .argument("[directory]", "Proyecto", ".")
    .option("--agent-file <name>", "AGENTS.md o CLAUDE.md", "AGENTS.md")
    .option("--force", "Reemplaza artefactos existentes")
    .action((directory: string, options: { agentFile: string; force?: boolean }) =>
      print({ created: createHarness(directory, options.agentFile, options.force ?? false) }),
    );
  harness
    .command("audit")
    .argument("[directory]", "Proyecto", ".")
    .action((directory: string) => print(auditHarness(directory)));
}
