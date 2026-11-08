#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { startGateway, startVirtualGateway } from "../mcp/gateway.js";
import { requireProject } from "../services/project.js";

const options = new Command()
  .option("--project <path>", "Directorio del proyecto")
  .option("--project-id <id>", "Proyecto del servidor para un gateway virtual")
  .parse()
  .opts();
try {
  if (options.project && options.projectId) throw new Error("Elige --project o --project-id");
  if (options.projectId) await startVirtualGateway(options.projectId);
  else await startGateway(requireProject(resolve(options.project ?? process.cwd())));
} catch (error) {
  process.stderr.write(`modai-mcp: ${(error as Error).message}\n`);
  process.exit(1);
}
