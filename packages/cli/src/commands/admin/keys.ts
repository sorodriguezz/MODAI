import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import type { Print } from "../../terminal/output.js";
import { type AccessOptions, accessGrants, replacementGrants, withAccessOptions } from "./access-options.js";

type CreateKeyOptions = AccessOptions & {
  label: string;
  owner?: string;
  role: string;
  service?: boolean;
};

const SCOPED_ACCESS_HELP = {
  organizations: "Acotar a estas organizaciones",
  projects: "Acotar a estos proyectos",
  scopes: "Acotar a estos namespaces, por ejemplo @skills",
};

async function createKey(options: CreateKeyOptions) {
  const api = serverApi();
  const wanted = options.owner;
  const owner = wanted
    ? (await api.users()).find((user) => user.id === wanted || user.username === wanted.toLowerCase())
    : undefined;
  if (options.owner && !owner) throw new Error(`No administras un usuario llamado ${options.owner}`);
  const ownership = options.service ? { ownerId: null } : owner ? { ownerId: owner.id } : {};
  const key = await api.createApiKey(options.label, options.role, accessGrants(options), ownership);
  return {
    id: key.id,
    label: key.label,
    role: key.role,
    owner: key.ownerName ?? "sin dueño",
    access: key.inherit ? "los mismos que su dueño" : "acotado",
    token: key.token,
  };
}

export function registerAdminCreateKey(admin: Command, print: Print): void {
  withAccessOptions(
    admin
      .command("create-key")
      .description("Crea una API key a nombre de un usuario, dentro de sus permisos (sin --owner: para tu usuario)")
      .requiredOption("--label <label>")
      .option("--owner <username|id>", "Usuario dueño de la key")
      .option("--role <role>", "reader, publisher, worker, org-admin o admin (como máximo el del dueño)", "reader"),
    SCOPED_ACCESS_HELP,
  )
    .option("--service", "Key de servicio sin dueño (solo con el token de instalación o administración global)")
    .action(async (options: CreateKeyOptions) => print(await createKey(options)));
}

export function registerAdminGrantKey(admin: Command, print: Print): void {
  withAccessOptions(admin.command("grant-key").argument("<id>")).action(async (id: string, options: AccessOptions) => {
    await serverApi().updateKeyGrants(id, replacementGrants(options));
    print("Accesos de la API key reemplazados.");
  });
}

export function registerAdminKeys(admin: Command, print: Print): void {
  admin
    .command("keys")
    .description("API keys que puedes administrar")
    .option("--all", "Incluye las revocadas")
    .action(async (options: { all?: boolean }) =>
      print(
        (await serverApi().apiKeys())
          .filter((key) => options.all || !key.revokedAt)
          .map((key) => ({
            id: key.id,
            label: key.label,
            role: key.role,
            lastUsed: key.lastUsedAt ?? "nunca",
            status: key.revokedAt ? "revocada" : "activa",
          })),
      ),
    );
}

export function registerAdminRevokeKey(admin: Command, print: Print): void {
  admin
    .command("revoke-key")
    .description("Revoca una API key")
    .argument("<id>")
    .action(async (id: string) => {
      await serverApi().revokeApiKey(id);
      print(`API key revocada: ${id}`);
    });
}
