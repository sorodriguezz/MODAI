#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { startGateway } from "../mcp/gateway.js";
import { requireProject } from "../services/project.js";

const options = new Command().option("--project <path>", "Directorio del proyecto", process.cwd()).parse().opts();
try {
  await startGateway(requireProject(resolve(options.project)));
} catch (error) {
  process.stderr.write(`modai-mcp: ${(error as Error).message}\n`);
  process.exit(1);
}
