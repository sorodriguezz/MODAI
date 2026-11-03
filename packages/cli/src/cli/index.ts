#!/usr/bin/env node
import { Command } from "commander";
import { ApiClient } from "@modai/sdk";
import { isV1Project, loadV1Project } from "@modai/core";
import { registerAgentCommands, commaList } from "./agent-commands.js";
import { registerClientCommands } from "./client-commands.js";
import { effectiveConnection } from "./connection.js";
import { print, setJsonMode } from "./output.js";
import { registerUpgradeCommand, startUpdateNotice } from "./upgrade.js";
import { registerAuthoringCommands } from "./commands/authoring.js";
import { registerContextCommands } from "./commands/context.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerRegistryCommands } from "./commands/registry.js";
import { registerServerCommands } from "./commands/server.js";
import { registerV1Commands } from "../v1/commands.js";
import { registerListCommands } from "../v1/list.js";
import { registerWorkspaceCommands } from "../v1/workspace.js";
import { tokenFor } from "../v1/runtime.js";

const program = new Command();
program.name("modai").description("MODAI: gestor de paquetes y capacidades para agentes de IA").version("0.8.0")
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
registerClientCommands(program, () => {
  // Embeddings use the project's server when it has one, otherwise the connected server.
  const server = isV1Project(process.cwd()) ? loadV1Project().file.context.server : undefined;
  if (server) return new ApiClient(server, tokenFor(server));
  const connection = effectiveConnection();
  return new ApiClient(connection.server, connection.token);
}, print);
registerUpgradeCommand(program, print);

program.configureOutput({ outputError: (message) => process.stderr.write(message) });
const showUpdateNotice = ["upgrade", "self-update", "worker"].includes(process.argv[2] ?? "") ? () => {} : startUpdateNotice(program.version()!);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
showUpdateNotice();
