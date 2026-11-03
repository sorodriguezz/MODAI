import type { Command } from "commander";
import semver from "semver";
import { addV1, capabilitiesV1, initV1, outdatedV1, removeV1, statusV1, syncV1, updateV1 } from "../../v1/commands.js";
import { requireV1Project, runSync, summarize } from "../../v1/runtime.js";
import { commaList } from "../agent-commands.js";
import { group } from "../groups.js";
import type { Print } from "../output.js";

/** Project lifecycle: modai.yaml + modai.lock. */
export function registerProjectCommands(program: Command, print: Print): void {
  program.command("init")
    .description("Inicializa MODAI en el proyecto actual (modai.yaml); no requiere servidor")
    .option("--name <name>", "Nombre del proyecto")
    .option("--registry <url|path>", "Registry de paquetes: URL de un servidor MODAI o carpeta local (repetible)", commaList)
    .option("--adapter <ids>", "Adaptadores activos, por ejemplo agent-skills,agents-md,claude-code,mcp", commaList)
    .option("--profile <package>", "Perfil o paquete inicial, por ejemplo @profiles/fullstack-quality")
    .option("--allow <permissions>", "Permisos de instalación concedidos en este equipo", commaList)
    .option("--memory <mode>", "Memoria: local, remote u off")
    .option("--project <id>", "Proyecto del servidor: comparte su memoria y habilita agentes y ejecuciones")
    .option("--server <url>", "Servidor MODAI específico para este proyecto")
    .action(options => initV1(process.cwd(), options, print));

  program.command("add")
    .description("Añade paquetes (y sus dependencias) al proyecto")
    .argument("<packages...>", "@scope/nombre[@rango] o file:../ruta")
    .option("--allow <permissions>", "Permisos de instalación concedidos en este equipo", commaList)
    .option("--force", "Sobrescribe archivos administrados que fueron modificados")
    .option("--keep-mine", "Conserva tus archivos modificados y deja la versión nueva al lado (.modai-new)")
    .action((specs: string[], options) => addV1(requireV1Project(), specs, options, print));

  program.command("remove")
    .description("Retira una dependencia directa conservando los archivos que modificaste")
    .argument("<package>", "@scope/nombre")
    .action((name: string) => removeV1(requireV1Project(), name, print));

  program.command("sync")
    .description("Reconstruye el entorno exacto desde modai.yaml y modai.lock")
    .option("--allow <permissions>", "Permisos de instalación aprobados en este equipo", commaList)
    .option("--frozen", "Falla si modai.lock no corresponde a modai.yaml (CI)")
    .option("--force", "Sobrescribe archivos administrados que fueron modificados")
    .option("--keep-mine", "Conserva tus archivos modificados y deja la versión nueva al lado (.modai-new)")
    .action(options => syncV1(requireV1Project(), options, print));

  program.command("update")
    .description("Actualiza dependencias dentro de los rangos de modai.yaml")
    .argument("[packages...]", "Paquetes a actualizar; por defecto todos")
    .option("--keep-mine", "Si modificaste archivos administrados, conserva tu versión y deja la nueva al lado (.modai-new)")
    .option("--force", "Sobrescribe tus cambios en archivos administrados")
    .action((names: string[] = [], options: { keepMine?: boolean; force?: boolean }) => updateV1(requireV1Project(), names, options, print));

  program.command("outdated").description("Compara el lock con las versiones disponibles en los registries").action(() => outdatedV1(requireV1Project(), print));
  program.command("status").description("Muestra el estado del proyecto").action(() => statusV1(requireV1Project(), print));
  group(program, "capability", "Capacidades del proyecto: contratos, proveedores y herramientas ejecutables")
    .command("list", { isDefault: true }).description("Contratos provistos y requeridos, herramientas, servidores MCP y skills del proyecto").action(() => capabilitiesV1(requireV1Project(), print));

  program.command("override")
    .description("Fija una versión o rango incluso si es una dependencia transitiva")
    .argument("<package>").argument("<range>")
    .action(async (name: string, range: string) => {
      if (!semver.validRange(range)) throw new Error(`Rango SemVer inválido: ${range}`);
      const { report } = await runSync(requireV1Project(), file => { file.overrides[name] = range; });
      print(`Override aplicado: ${name}@${range}\n${summarize(report)}`);
    });
}
