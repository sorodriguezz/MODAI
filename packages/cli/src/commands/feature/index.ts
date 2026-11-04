import type { Command } from "commander";
import { group } from "../../terminal/help-sections.js";
import type { Print } from "../../terminal/output.js";
import { registerFeatureDefine, registerFeatureUndefine } from "./define.js";
import { registerFeatureList } from "./list.js";
import { registerFeatureDisable, registerFeatureEnable, registerFeatureReset } from "./toggle.js";

export function registerFeatureCommands(program: Command, print: Print): void {
  const feature = group(
    program,
    "feature",
    "Features de los paquetes instalados: partes opcionales que se activan o se quitan",
  );
  registerFeatureList(feature, print);
  registerFeatureEnable(feature, print);
  registerFeatureDisable(feature, print);
  registerFeatureReset(feature, print);
  registerFeatureDefine(feature, print);
  registerFeatureUndefine(feature, print);
}
