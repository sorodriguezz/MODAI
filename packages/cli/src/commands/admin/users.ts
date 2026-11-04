import type { Role } from "@modai/sdk";
import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

type Access = { organizations?: string[]; projects?: string[]; scopes?: string[] };
type CreateOptions = Access & { password: string; name?: string; role: Role };
type UpdateOptions = Access & { name?: string; role?: Role; disable?: boolean; enable?: boolean; password?: string };

const withAccess = (command: Command) =>
  command
    .option("--organizations <ids>", "Organizaciones", commaList)
    .option("--projects <ids>", "Proyectos", commaList)
    .option("--scopes <namespaces>", "Namespaces", commaList);

export function registerAdminUsers(admin: Command, print: Print): void {
  admin
    .command("users")
    .description("Usuarios del panel que puedes administrar")
    .action(async () =>
      print(
        (await serverApi().users()).map((user) => ({
          id: user.id,
          username: user.username,
          name: user.displayName,
          role: user.role,
          organizations: user.organizationIds.length,
          projects: user.projectIds.length,
          status: user.disabledAt ? "desactivado" : "activo",
        })),
      ),
    );
}

export function registerAdminCreateUser(admin: Command, print: Print): void {
  withAccess(
    admin
      .command("create-user")
      .description("Crea un usuario del panel")
      .argument("<username>")
      .requiredOption("--password <password>", "Contraseña inicial (mín. 10 caracteres)")
      .option("--name <displayName>", "Nombre visible")
      .option("--role <role>", "reader, publisher, worker, org-admin o admin", "reader"),
  ).action(async (username: string, options: CreateOptions) => {
    const user = await serverApi().createUser({
      username,
      password: options.password,
      displayName: options.name,
      role: options.role,
      organizationIds: options.organizations,
      projectIds: options.projects,
      packageScopes: options.scopes,
    });
    print(`Usuario creado: ${user.username} (${user.role}, id ${user.id})`);
  });
}

export function registerAdminUpdateUser(admin: Command, print: Print): void {
  withAccess(
    admin
      .command("update-user")
      .description("Cambia rol, accesos o estado de un usuario (las listas reemplazan las actuales)")
      .argument("<id>")
      .option("--name <displayName>")
      .option("--role <role>"),
  )
    .option("--disable", "Desactiva la cuenta y cierra sus sesiones")
    .option("--enable", "Reactiva la cuenta")
    .option("--password <password>", "Restablece la contraseña")
    .action(async (id: string, options: UpdateOptions) => {
      const user = await serverApi().updateUser(id, {
        displayName: options.name,
        role: options.role,
        organizationIds: options.organizations,
        projectIds: options.projects,
        packageScopes: options.scopes,
        password: options.password,
        ...(options.disable ? { disabled: true } : options.enable ? { disabled: false } : {}),
      });
      print(`Usuario actualizado: ${user.username} (${user.role}${user.disabledAt ? ", desactivado" : ""})`);
    });
}

export function registerAdminDeleteUser(admin: Command, print: Print): void {
  admin
    .command("delete-user")
    .description("Elimina un usuario")
    .argument("<id>")
    .action(async (id: string) => {
      await serverApi().deleteUser(id);
      print(`Usuario eliminado: ${id}`);
    });
}
