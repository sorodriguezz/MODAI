#!/usr/bin/env node
import { Command } from "commander";
import { registerCommands } from "../commands/index.js";
import { startUpdateNotice } from "../services/update-notice.js";
import { applyHelpSections } from "../terminal/help-sections.js";
import { print, setJsonMode } from "../terminal/output.js";
import { isPromptCancel, paint } from "../terminal/prompts.js";

const program = new Command();
program
  .name("modai")
  .description("MODAI: gestor de paquetes y capacidades para agentes de IA")
  .version("0.12.0")
  .option("--json", "Salida JSON para scripts (en cualquier comando)")
  .hook("preAction", () => setJsonMode(Boolean(program.opts().json)));

registerCommands(program, print);
applyHelpSections(program);

program.configureOutput({ outputError: (message) => process.stderr.write(message) });
const argv = process.argv;
const words = argv.slice(2).filter((value) => !value.startsWith("-"));
const quiet = ["upgrade", "self-update"].includes(words[0] ?? "") || (words[0] === "agent" && words[1] === "worker");
const showUpdateNotice = quiet ? () => {} : startUpdateNotice(program.version()!);

try {
  await program.parseAsync(argv);
} catch (error) {
  if (isPromptCancel(error)) {
    process.stderr.write(`${paint().dim("Cancelado.")}\n`);
    process.exitCode = 130;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${paint().red.bold("Error:")} ${message}\n`);
    process.exitCode = 1;
  }
}
showUpdateNotice();
