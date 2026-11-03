#!/usr/bin/env node
import { Command } from "commander";
import { ApiClient } from "@modai/sdk";
import { isV1Project, loadV1Project } from "@modai/core";
import { registerAgentCommands, commaList } from "./agent-commands.js";
import { registerClientCommands } from "./client-commands.js";
import { effectiveConnection } from "./connection.js";
import { applyHelpSections } from "./groups.js";
import { print, setJsonMode } from "./output.js";
import { isPromptCancel, paint } from "./ui.js";
import { registerUpgradeCommand, startUpdateNotice } from "./upgrade.js";
import { registerAuthoringCommands } from "./commands/authoring.js";
import { registerContextCommands } from "./commands/context.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerRegistryCommands } from "./commands/registry.js";
import { registerServerCommands } from "./commands/server.js";
import { registerTemplateCommands } from "./commands/template.js";
import { registerLibraryCommands } from "./commands/library.js";
import { registerV1Commands } from "../v1/commands.js";
import { registerListCommands } from "../v1/list.js";
import { registerWorkspaceCommands } from "../v1/workspace.js";
import { tokenFor } from "../v1/runtime.js";

const program = new Command();
program.name("modai").description("MODAI: gestor de paquetes y capacidades para agentes de IA").version("0.10.0")
  .option("--json", "Salida JSON para scripts (en cualquier comando)")
  .hook("preAction", () => setJsonMode(Boolean(program.opts().json)));

registerProjectCommands(program, print);
registerListCommands(program, print, commaList);
registerWorkspaceCommands(program, print);
registerContextCommands(program, print);
registerRegistryCommands(program, print);
registerAuthoringCommands(program, print);
registerV1Commands(program, print);
registerAgentCommands(program, print);
registerServerCommands(program, print);
registerTemplateCommands(program, print);
registerLibraryCommands(program, print);
registerClientCommands(program, () => {
  // Embeddings use the project's server when it has one, otherwise the connected server.
  const server = isV1Project(process.cwd()) ? loadV1Project().file.context.server : undefined;
  if (server) return new ApiClient(server, tokenFor(server));
  const connection = effectiveConnection();
  return new ApiClient(connection.server, connection.token);
}, print);
registerUpgradeCommand(program, print);

applyHelpSections(program);

program.configureOutput({ outputError: (message) => process.stderr.write(message) });
const argv = process.argv;
const words = argv.slice(2).filter(value => !value.startsWith("-"));
// No update check while upgrading, nor in a long-running worker.
const quiet = ["upgrade", "self-update"].includes(words[0] ?? "") || (words[0] === "agent" && words[1] === "worker");
const showUpdateNotice = quiet ? () => {} : startUpdateNotice(program.version()!);

try {
  await program.parseAsync(argv);
} catch (error) {
  if (isPromptCancel(error)) { process.stderr.write(`${paint().dim("Cancelado.")}\n`); process.exitCode = 130; }
  else {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${paint().red.bold("Error:")} ${message}\n`);
    process.exitCode = 1;
  }
}
showUpdateNotice();
