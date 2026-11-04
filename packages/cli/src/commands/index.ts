import type { Command } from "commander";
import type { Print } from "../terminal/output.js";
import { registerAdapterCommands } from "./adapter/index.js";
import { registerAdminCommands } from "./admin/index.js";
import { registerAgentCommands } from "./agent/index.js";
import { registerCapabilityCommands } from "./capability/index.js";
import { registerCategoryCommands } from "./category/index.js";
import { registerClientCommands } from "./client/index.js";
import { registerComponentCommands } from "./component/index.js";
import { registerContextCommands } from "./context/index.js";
import { registerFeatureCommands } from "./feature/index.js";
import { registerHarnessCommands } from "./harness/index.js";
import { registerKnowledgeCommands } from "./knowledge/index.js";
import { registerMemoryCommands } from "./memory/index.js";
import { registerPackageCommands } from "./package/index.js";
import { registerPermissionsCommands } from "./permissions/index.js";
import { registerProjectCommands } from "./project/index.js";
import { registerProjectsCommands } from "./projects/index.js";
import { registerRegistryCommands } from "./registry/index.js";
import { registerServerCommands } from "./server/index.js";
import { registerSkillCommands } from "./skill/index.js";
import { registerTemplateCommands } from "./template/index.js";
import { registerUpgradeCommand } from "./upgrade/index.js";
import { registerWorkspaceCommands } from "./workspace/index.js";

const GROUPS: Array<(program: Command, print: Print) => void> = [
  registerProjectCommands,
  registerTemplateCommands,
  registerFeatureCommands,
  registerWorkspaceCommands,
  registerComponentCommands,
  registerHarnessCommands,
  registerCapabilityCommands,
  registerAdapterCommands,
  registerPermissionsCommands,
  registerContextCommands,
  registerMemoryCommands,
  registerKnowledgeCommands,
  registerPackageCommands,
  registerSkillCommands,
  registerCategoryCommands,
  registerRegistryCommands,
  registerServerCommands,
  registerProjectsCommands,
  registerAgentCommands,
  registerAdminCommands,
  registerClientCommands,
  registerUpgradeCommand,
];

export function registerCommands(program: Command, print: Print): void {
  for (const register of GROUPS) register(program, print);
}
