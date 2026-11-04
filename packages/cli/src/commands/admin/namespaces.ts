import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import type { Print } from "../../terminal/output.js";

type UpdateOptions = { organization?: string; restricted?: boolean; internal?: boolean; description?: string };

function namespaceChanges(options: UpdateOptions) {
  return {
    ...(options.organization ? { organizationId: options.organization === "none" ? null : options.organization } : {}),
    ...(options.restricted
      ? { visibility: "restricted" as const }
      : options.internal
        ? { visibility: "internal" as const }
        : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
  };
}

export function registerAdminNamespaces(admin: Command, print: Print): void {
  admin
    .command("namespaces")
    .description("Namespaces de paquetes, su organización y visibilidad")
    .action(async () =>
      print(
        (await serverApi().namespaces()).map((ns) => ({
          name: ns.name,
          organization: ns.organizationName ?? "—",
          visibility: ns.visibility,
          packages: ns.packages,
          publish: ns.canPublish,
        })),
      ),
    );
}

export function registerAdminCreateNamespace(admin: Command, print: Print): void {
  admin
    .command("create-namespace")
    .argument("<name>", "Por ejemplo @acme-pagos")
    .option("--organization <id>", "Organización dueña")
    .option("--restricted", "Solo quien tenga el namespace asignado ve sus paquetes")
    .option("--description <text>", "Descripción")
    .action(async (name: string, options: { organization?: string; restricted?: boolean; description?: string }) =>
      print(
        await serverApi().createNamespace({
          name,
          organizationId: options.organization,
          visibility: options.restricted ? "restricted" : "internal",
          description: options.description,
        }),
      ),
    );
}

export function registerAdminUpdateNamespace(admin: Command, print: Print): void {
  admin
    .command("update-namespace")
    .description("Cambia organización, visibilidad o descripción de un namespace")
    .argument("<name>")
    .option("--organization <id>", 'Organización dueña ("none" para quitarla)')
    .option("--restricted", "Solo quien lo tenga asignado ve sus paquetes")
    .option("--internal", "Cualquier identidad autenticada ve sus paquetes")
    .option("--description <text>")
    .action(async (name: string, options: UpdateOptions) =>
      print(await serverApi().updateNamespace(name, namespaceChanges(options))),
    );
}

export function registerAdminDeleteNamespace(admin: Command, print: Print): void {
  admin
    .command("delete-namespace")
    .description("Elimina un namespace sin paquetes")
    .argument("<name>")
    .action(async (name: string) => {
      await serverApi().deleteNamespace(name);
      print(`Namespace eliminado: ${name}`);
    });
}
