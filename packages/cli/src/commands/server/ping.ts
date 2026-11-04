import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";
import type { RegistrySource } from "@modai/contracts/manifest";
import type { V1Project } from "@modai/core";
import type { Command } from "commander";
import { loadClientConfig } from "../../services/config.js";
import { tokenFor } from "../../services/connection.js";
import { currentProject } from "../../services/project.js";
import { type Check, pingServer } from "../../services/server-health.js";
import { formatTable, isJsonMode, type Print } from "../../terminal/output.js";

const trim = (url: string) => url.replace(/\/+$/, "");
const ICONS: Record<Check["status"], string> = { ok: "✓", aviso: "!", error: "✗" };

function folderCheck(project: V1Project, registry: RegistrySource): Check {
  const path = resolve(project.root, registry.path!);
  try {
    accessSync(path, constants.R_OK);
    return { check: `Registry ${registry.name}`, status: "ok", detail: `carpeta ${path}` };
  } catch {
    return {
      check: `Registry ${registry.name}`,
      status: "aviso",
      detail: `la carpeta ${path} no existe o no se puede leer (se crea al publicar)`,
    };
  }
}

async function registryChecks(
  project: V1Project | undefined,
  target: string | undefined,
  version: string,
  timeoutMs: number,
) {
  const checks: Check[] = [];
  for (const registry of project?.file.registries ?? []) {
    if (registry.url && target && trim(registry.url) === trim(target)) continue;
    if (registry.url) {
      const [first] = await pingServer(registry.url, version, { timeoutMs });
      checks.push({ ...first, check: `Registry ${registry.name}` });
    } else checks.push(folderCheck(project!, registry));
  }
  return checks;
}

function printChecks(checks: Check[], print: Print): void {
  if (isJsonMode()) print(checks);
  else
    print(
      formatTable(
        checks.map((item) => ({ "": ICONS[item.status], check: item.check, detail: item.detail })),
        300,
      ),
    );
}

export function registerServerPing(server: Command, print: Print, version: string): void {
  server
    .command("ping")
    .description("Comprueba si el servidor está arriba: latencia, versión, credencial y registries del proyecto")
    .argument("[url]", "Servidor; por defecto el del proyecto o el conectado")
    .option("--timeout <ms>", "Tiempo máximo de espera por servidor", "5000")
    .action(async (url: string | undefined, options: { timeout: string }) => {
      const project = currentProject();
      const target = url ?? project?.file.context.server ?? process.env.MODAI_SERVER ?? loadClientConfig()?.server;
      const timeoutMs = Number(options.timeout);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000)
        throw new Error("--timeout debe estar entre 100 y 60000 ms");
      const checks: Check[] = target
        ? await pingServer(target, version, { timeoutMs, token: tokenFor(trim(target)) })
        : [];
      checks.push(...(await registryChecks(project, target, version, timeoutMs)));
      if (!checks.length)
        throw new Error(
          "No hay servidor que comprobar: indica una URL (modai server ping https://…) o conecta la CLI con modai server connect",
        );
      printChecks(checks, print);
      if (checks.some((item) => item.status === "error")) process.exitCode = 1;
    });
}
