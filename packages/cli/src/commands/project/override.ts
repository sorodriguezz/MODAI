import type { Command } from "commander";
import semver from "semver";
import { requireProject } from "../../services/project.js";
import { runSync } from "../../services/sync.js";
import type { Print } from "../../terminal/output.js";
import { summarize } from "../../terminal/sync-summary.js";

export function registerOverride(program: Command, print: Print): void {
  program
    .command("override")
    .description("Fija una versión o rango incluso si es una dependencia transitiva")
    .argument("<package>")
    .argument("<range>")
    .action(async (name: string, range: string) => {
      if (!semver.validRange(range)) throw new Error(`Rango SemVer inválido: ${range}`);
      const { report } = await runSync(requireProject(), (file) => {
        file.overrides[name] = range;
      });
      print(`Override aplicado: ${name}@${range}\n${summarize(report)}`);
    });
}
