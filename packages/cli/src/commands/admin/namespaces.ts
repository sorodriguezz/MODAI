import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import type { Print } from "../../terminal/output.js";

type OwnerOptions = { organization?: string; user?: string };
type UpdateOptions = OwnerOptions & {
  restricted?: boolean;
  internal?: boolean;
  shared?: boolean;
  description?: string;
};

async function namespaceOwner(options: OwnerOptions) {
  if (options.organization && options.user) throw new Error("Usa --organization o --user, no ambos");
  if (options.organization) return { organizationId: options.organization, ownerUserId: null };
  if (!options.user) return {};
  const user = (await serverApi().users()).find((item) => item.username === options.user || item.id === options.user);
  if (!user) throw new Error(`No existe el usuario ${options.user}`);
  return { organizationId: null, ownerUserId: user.id };
}

async function namespaceChanges(options: UpdateOptions) {
  const selected = (["restricted", "internal", "shared"] as const).filter((item) => options[item]);
  if (selected.length > 1) throw new Error("Elige una sola visibilidad: --internal, --restricted o --shared");
  return {
    ...(await namespaceOwner(options)),
    ...(selected[0] ? { visibility: selected[0] } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
  };
}

export function registerAdminNamespaces(admin: Command, print: Print): void {
  admin
    .command("namespaces")
    .description("Namespaces de paquetes, su dueño (organización o usuario) y visibilidad")
    .action(async () =>
      print(
        (await serverApi().namespaces()).map((ns) => ({
          name: ns.name,
          owner: ns.ownerKind === "organization" ? `org:${ns.organizationName}` : `user:${ns.ownerUsername}`,
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
    .description("Crea un namespace con su dueño: una organización o un usuario")
    .argument("<name>", "Por ejemplo @acme-pagos")
    .option("--organization <id>", "Organización dueña")
    .option("--user <username>", "Usuario dueño")
    .option("--restricted", "Solo quien tenga el namespace asignado ve sus paquetes")
    .option("--shared", "Comparte los paquetes con toda la instancia autenticada")
    .option("--description <text>", "Descripción")
    .action(async (name: string, options: UpdateOptions) => {
      if (!options.organization && !options.user) throw new Error("Indica el dueño con --organization o --user");
      print(
        await serverApi().createNamespace({
          name,
          ...(await namespaceChanges(options)),
        }),
      );
    });
}

export function registerAdminUpdateNamespace(admin: Command, print: Print): void {
  admin
    .command("update-namespace")
    .description("Cambia dueño, visibilidad o descripción de un namespace")
    .argument("<name>")
    .option("--organization <id>", "Pasa el namespace a esta organización")
    .option("--user <username>", "Pasa el namespace a este usuario")
    .option("--restricted", "Solo quien lo tenga asignado ve sus paquetes")
    .option("--internal", "Visible para miembros de la organización dueña o para su dueño personal")
    .option("--shared", "Comparte los paquetes con toda la instancia autenticada")
    .option("--description <text>")
    .action(async (name: string, options: UpdateOptions) =>
      print(await serverApi().updateNamespace(name, await namespaceChanges(options))),
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
