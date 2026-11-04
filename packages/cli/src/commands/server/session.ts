import type { Command } from "commander";
import { clientConfigPath, loadClientConfig, saveClientConfig } from "../../services/config.js";
import { effectiveConnection, serverApi } from "../../services/connection.js";
import { currentProject } from "../../services/project.js";
import type { Print } from "../../terminal/output.js";

function logoutNotes(previous: string | undefined): string[] {
  const notes = [`Sesión cerrada${previous ? ` en ${previous}` : ""}. La API key se borró de ${clientConfigPath}.`];
  if (process.env.MODAI_API_TOKEN || process.env.MODAI_SERVER)
    notes.push(
      "Ojo: MODAI_API_TOKEN o MODAI_SERVER siguen definidas en tu entorno y se seguirán usando; quítalas con unset.",
    );
  const project = currentProject();
  if (previous && project?.file.context.server?.replace(/\/+$/, "") === previous.replace(/\/+$/, ""))
    notes.push(
      `Este proyecto sigue vinculado a ${previous} en modai.yaml; para moverlo, cambia context.server y su registry.`,
    );
  notes.push("Para usar otro servidor: modai server connect <url>");
  return notes;
}

export function registerServerLogout(server: Command, print: Print): void {
  server
    .command("logout")
    .alias("disconnect")
    .description(
      "Cierra la sesión: olvida el servidor y la API key guardados en este equipo (para cambiar de servidor)",
    )
    .action(() => {
      const config = loadClientConfig();
      if (!config?.server && !config?.token) {
        print("No había ninguna sesión guardada.");
        return;
      }
      const { server: previous, token: _token, ...rest } = config;
      saveClientConfig(rest);
      print(logoutNotes(previous).join("\n"));
    });
}

const yes = (value: boolean) => (value ? "sí" : "no");

export function registerServerWhoami(server: Command, print: Print): void {
  server
    .command("whoami")
    .description("Muestra la identidad, su rol y lo que puede hacer en el servidor")
    .action(async () => {
      const connection = effectiveConnection();
      const api = serverApi();
      const session = await api.session();
      const projects = (await api.projects()).map((project) => ({ id: project.id, name: project.name }));
      const permissions = session.permissions;
      const publish = permissions.publish;
      print({
        server: connection.server,
        label: session.label,
        role: session.role,
        organizations: permissions.organizations.map((org) => (org.manage ? `${org.name} (administra)` : org.name)),
        projects,
        publish: publish.all ? "todos los namespaces" : publish.namespaces.length ? publish.namespaces : "ninguno",
        can: {
          createProjects: yes(permissions.createProjects),
          writeMemory: yes(permissions.writeMemory),
          submitRuns: yes(permissions.submitRuns),
          manageUsersAndKeys: yes(permissions.manage.users),
          manageOrganizations: yes(permissions.manage.organizations),
          audit: yes(permissions.manage.audit),
        },
      });
    });
}

export function registerServerKeys(server: Command, print: Print): void {
  server
    .command("keys")
    .description("Tus API keys (las del usuario dueño de esta credencial). Se crean en el panel: Mis API keys")
    .action(async () =>
      print(
        (await serverApi().myApiKeys())
          .filter((key) => !key.revokedAt)
          .map((key) => ({
            id: key.id,
            label: key.label,
            role: key.role,
            access: key.inherit ? "como tu cuenta" : "acotado",
            lastUsed: key.lastUsedAt ?? "nunca",
          })),
      ),
    );
  server
    .command("revoke-key")
    .description("Revoca una de tus API keys (por ejemplo, la de un equipo perdido)")
    .argument("<id>")
    .action(async (id: string) => {
      await serverApi().revokeMyApiKey(id);
      print(`API key revocada: ${id}`);
    });
}
