import type { Command } from "commander";
import type { Print } from "../../terminal/output.js";
import { registerAdd } from "./add.js";
import { registerInit } from "./init.js";
import { registerList } from "./list.js";
import { registerOutdated } from "./outdated.js";
import { registerOverride } from "./override.js";
import { registerRemove } from "./remove.js";
import { registerStatus } from "./status.js";
import { registerSync } from "./sync.js";
import { registerUpdate } from "./update.js";

export function registerProjectCommands(program: Command, print: Print): void {
  registerInit(program, print);
  registerAdd(program, print);
  registerRemove(program, print);
  registerSync(program, print);
  registerUpdate(program, print);
  registerOutdated(program, print);
  registerStatus(program, print);
  registerList(program);
  registerOverride(program, print);
}
