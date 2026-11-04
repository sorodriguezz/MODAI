import type { Command } from "commander";
import { group } from "../../terminal/help-sections.js";
import type { Print } from "../../terminal/output.js";
import { registerTemplateInit, registerTemplatePublish } from "./authoring.js";
import { registerTemplateDownload, registerTemplateInfo, registerTemplateList } from "./catalog.js";
import { registerTemplateUse } from "./use.js";

export function registerTemplateCommands(program: Command, print: Print): void {
  const template = group(
    program,
    "template",
    "Templates de proyecto: paquetes kind: Template que crean un proyecto nuevo (por ejemplo NestJS con SDD)",
  );
  registerTemplateList(template, print);
  registerTemplateInit(template, print);
  registerTemplatePublish(template, print);
  registerTemplateUse(template, print);
  registerTemplateInfo(template, print);
  registerTemplateDownload(template, print);
}
