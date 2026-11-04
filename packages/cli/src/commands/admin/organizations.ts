import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import type { Print } from "../../terminal/output.js";

export function registerAdminCreateOrganization(admin: Command, print: Print): void {
  admin
    .command("create-organization")
    .argument("<name>")
    .option("--description <text>", "Descripción")
    .action(async (name: string, options: { description?: string }) =>
      print(await serverApi().createOrganization(name, options.description)),
    );
}

export function registerAdminOrganizations(admin: Command, print: Print): void {
  admin
    .command("organizations")
    .description("Organizaciones visibles con sus proyectos, namespaces y miembros")
    .action(async () =>
      print(
        (await serverApi().organizations()).map((org) => ({
          id: org.id,
          name: org.name,
          projects: org.projects,
          namespaces: org.namespaces,
          members: org.members,
          manage: org.canManage,
        })),
      ),
    );
}

export function registerAdminUpdateOrganization(admin: Command, print: Print): void {
  admin
    .command("update-organization")
    .description("Renombra o describe una organización")
    .argument("<id>")
    .option("--name <name>")
    .option("--description <text>")
    .action(async (id: string, options: { name?: string; description?: string }) =>
      print(await serverApi().updateOrganization(id, options)),
    );
}

export function registerAdminDeleteOrganization(admin: Command, print: Print): void {
  admin
    .command("delete-organization")
    .description("Elimina una organización vacía")
    .argument("<id>")
    .requiredOption("--confirm <name>", "Nombre exacto de la organización")
    .action(async (id: string, options: { confirm: string }) => {
      await serverApi().deleteOrganization(id, options.confirm);
      print(`Organización eliminada: ${options.confirm}`);
    });
}
