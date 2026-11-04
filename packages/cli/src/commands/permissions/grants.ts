import { type InstalledPackage, inspectWorkspace, loadGrants, loadV1Project, saveGrants } from "@modai/core";
import type { Command } from "commander";
import { requireProject } from "../../services/project.js";
import type { Print } from "../../terminal/output.js";
import { confirmAction } from "../../terminal/prompts.js";

type Locked = { version: string; integrity: string; permissions: string[]; features: string[] };

function grantPreview(name: string, locked: Locked, item: InstalledPackage): string {
  const { tools, mcpServers } = item.manifest.spec.contributes;
  const features = locked.features.length
    ? `\nFeatures activas: ${locked.features.join(", ")} (la autorización vale solo para estas)`
    : "";
  const toolText = tools.map((tool) => `${tool.name} → ${tool.command} ${tool.args.join(" ")}`).join("; ") || "ninguna";
  const serverText =
    mcpServers.map((server) => `${server.name} → ${server.command} ${server.args.join(" ")}`).join("; ") || "ninguno";
  return `${name}@${locked.version} (${locked.integrity})${features}\nPermisos declarados: ${locked.permissions.join(", ") || "ninguno"}\nHerramientas: ${toolText}\nServidores MCP: ${serverText}\nMODAI no es un sandbox: un proceso autorizado se ejecuta con tus permisos de usuario.`;
}

export function registerPermissionsList(permissions: Command, print: Print): void {
  permissions
    .command("list", { isDefault: true })
    .description("Permisos declarados y concedidos en este equipo para el proyecto")
    .action(() => {
      const root = requireProject(),
        project = loadV1Project(root),
        grants = loadGrants(root);
      print({
        install: grants.install,
        packages: Object.fromEntries(
          inspectWorkspace(project).map((item) => [
            item.name,
            {
              declared: item.manifest.spec.permissions,
              granted: grants.packages[item.name]?.permissions ?? [],
              allowed: item.authorization.allowed,
              reason: item.authorization.reason,
            },
          ]),
        ),
      });
    });
}

export function registerPermissionsGrant(permissions: Command, print: Print): void {
  permissions
    .command("grant")
    .description("Autoriza en este equipo las herramientas y servidores MCP de un paquete instalado")
    .argument("<package>")
    .option("--yes", "No pide confirmación")
    .action(async (name: string, options: { yes?: boolean }) => {
      const root = requireProject(),
        project = loadV1Project(root);
      const locked = project.lock.packages[name];
      if (!locked) throw new Error(`${name} no está instalado`);
      const item = inspectWorkspace(project).find((entry) => entry.name === name)!;
      if (!item.verified)
        throw new Error(`La copia local de ${name} no supera la verificación de integridad; ejecuta modai sync`);
      print(grantPreview(name, locked, item));
      if (!(await confirmAction(`¿Autorizar ${name} en este equipo?`, options.yes))) {
        print("Sin cambios.");
        return;
      }
      const grants = loadGrants(root);
      grants.packages[name] = {
        integrity: locked.integrity,
        permissions: locked.permissions,
        features: locked.features,
        grantedAt: new Date().toISOString(),
      };
      saveGrants(root, grants);
      print(
        `Autorizado ${name}. Sus herramientas quedan disponibles en el gateway MCP (modai-mcp) y en modai capability run.`,
      );
    });
}

export function registerPermissionsRevoke(permissions: Command, print: Print): void {
  permissions
    .command("revoke")
    .description("Retira la autorización local de un paquete")
    .argument("<package>")
    .action((name: string) => {
      const root = requireProject(),
        grants = loadGrants(root);
      delete grants.packages[name];
      saveGrants(root, grants);
      print(`Autorización retirada: ${name}`);
    });
}
