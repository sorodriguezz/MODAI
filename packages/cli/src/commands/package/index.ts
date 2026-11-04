import type { Command } from "commander";
import { group } from "../../terminal/help-sections.js";
import type { Print } from "../../terminal/output.js";
import { registerPackageKeygen, registerPackageScaffold, registerPackageValidate } from "./authoring.js";
import { registerPackagePublish } from "./publish.js";
import {
  registerPackageDeprecate,
  registerPackageDownload,
  registerPackageUnpublish,
  registerPackageUsage,
  registerPackageYank,
} from "./versions.js";

export function registerPackageCommands(program: Command, print: Print): void {
  const pkg = group(program, "package", "Crear, validar, publicar y retirar paquetes");
  registerPackagePublish(pkg, print);
  registerPackageUsage(pkg, print);
  registerPackageDownload(pkg, print);
  registerPackageDeprecate(pkg, print);
  registerPackageYank(pkg, print);
  registerPackageUnpublish(pkg, print);
  registerPackageScaffold(pkg, print);
  registerPackageValidate(pkg, print);
  registerPackageKeygen(pkg, print);
}
