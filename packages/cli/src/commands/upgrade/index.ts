import type { Command } from "commander";
import semver from "semver";
import { readUpdateCache, writeUpdateCache } from "../../services/update-notice.js";
import { CLI_PACKAGE, detectInstall, fetchDistTag, type Install, runPackageManager } from "../../services/upgrade.js";
import type { Print } from "../../terminal/output.js";
import { confirmAction } from "../../terminal/prompts.js";

type UpgradeOptions = { check?: boolean; tag: string; yes?: boolean };

function manualHint(install: Install, tag: string, spec: string): string {
  return install.kind === "npx"
    ? `Se está ejecutando con npx: usa npx ${CLI_PACKAGE}@${tag} o instálala con npm install -g ${spec}`
    : `Esta CLI no es una instalación global de npm (por ejemplo, npm link desde el repositorio o una dependencia de un proyecto). Actualiza el repositorio y recompila, o instala con: npm install -g ${spec}`;
}

async function install(current: string, latest: string, options: UpgradeOptions, print: Print): Promise<void> {
  const found = detectInstall();
  const spec = `${CLI_PACKAGE}@${latest}`;
  if (!found.command) {
    print(`Hay una versión nueva: ${current} → ${latest}.\n${manualHint(found, options.tag, spec)}`);
    return;
  }
  const command = [...found.command, spec].join(" ");
  if (!(await confirmAction(`¿Actualizar MODAI ${current} → ${latest} con ${command}?`, options.yes))) {
    print("Sin cambios.");
    return;
  }
  const [binary, ...args] = found.command;
  const result = runPackageManager(binary, [...args, spec], { stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(
      `La actualización falló (código ${result.status ?? result.error?.message}). Si es un problema de permisos, revisa el prefijo global de npm o repite: ${command}`,
    );
  print(`MODAI actualizado a ${latest}. Comprueba con: modai --version`);
}

export function registerUpgradeCommand(program: Command, print: Print): void {
  program
    .command("upgrade")
    .alias("self-update")
    .description("Actualiza la CLI de MODAI a la última versión publicada en npm")
    .option("--check", "Solo informa si hay una versión nueva; no instala nada")
    .option("--tag <tag>", "Etiqueta de npm: latest o next (prerelease)", "latest")
    .option("--yes", "No pide confirmación")
    .action(async (options: UpgradeOptions) => {
      const current = program.version()!;
      const latest = await fetchDistTag(options.tag);
      if (!semver.valid(latest)) throw new Error(`El registry devolvió una versión no válida: ${latest}`);
      writeUpdateCache(options.tag === "latest" ? latest : (readUpdateCache()?.latest ?? latest));
      if (!semver.gt(latest, current)) {
        print(`MODAI ${current} ya es la última versión (${options.tag}: ${latest}).`);
        return;
      }
      if (options.check) {
        print(
          `Hay una versión nueva: ${current} → ${latest}. Actualiza con: modai upgrade${options.tag === "latest" ? "" : ` --tag ${options.tag}`}`,
        );
        return;
      }
      await install(current, latest, options, print);
    });
}
