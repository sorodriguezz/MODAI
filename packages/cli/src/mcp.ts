#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { startV1Gateway } from "./v1/gateway.js";
import { requireV1Project } from "./v1/runtime.js";

// One MCP server per project: knowledge, memory, skills, authorised tools and the active agent.
const options = new Command().option("--project <path>", "Directorio del proyecto", process.cwd()).parse().opts();
try {
  await startV1Gateway(requireV1Project(resolve(options.project)));
} catch (error) {
  process.stderr.write(`modai-mcp: ${(error as Error).message}\n`);
  process.exit(1);
}
