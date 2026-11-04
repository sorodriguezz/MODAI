import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

type CreateKeyOptions = {
  label: string;
  owner?: string;
  role: string;
  projects?: string[];
  organizations?: string[];
  scopes?: string[];
  service?: boolean;
};

async function createKey(options: CreateKeyOptions) {
  const api = serverApi();
  const wanted = options.owner;
  const owner = wanted
    ? (await api.users()).find((user) => user.id === wanted || user.username === wanted.toLowerCase())
    : undefined;
  if (options.owner && !owner) throw new Error(`No administras un usuario llamado ${options.owner}`);
  const ownership = options.service ? { ownerId: null } : owner ? { ownerId: owner.id } : {};
  const key = await api.createApiKey(
    options.label,
    options.role,
    { projectIds: options.projects, organizationIds: options.organizations, packageScopes: options.scopes },
    ownership,
  );
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
  admin
    .command("create-key")
    .description("Crea una API key a nombre de un usuario, dentro de sus permisos (sin --owner: para tu usuario)")
    .requiredOption("--label <label>")
    .option("--owner <username|id>", "Usuario dueño de la key")
    .option("--role <role>", "reader, publisher, worker, org-admin o admin (como máximo el del dueño)", "reader")
    .option("--projects <ids>", "Acotar a estos proyectos", commaList)
    .option("--organizations <ids>", "Acotar a estas organizaciones", commaList)
    .option("--scopes <scopes>", "Acotar a estos namespaces, por ejemplo @skills", commaList)
    .option("--service", "Key de servicio sin dueño (solo con el token de instalación o administración global)")
    .action(async (options: CreateKeyOptions) => print(await createKey(options)));
}

export function registerAdminGrantKey(admin: Command, print: Print): void {
  admin
    .command("grant-key")
    .argument("<id>")
    .option("--projects <ids>", "Proyectos", commaList)
    .option("--organizations <ids>", "Organizaciones", commaList)
    .option("--scopes <scopes>", "Namespaces", commaList)
    .action(async (id: string, options: { projects?: string[]; organizations?: string[]; scopes?: string[] }) => {
      await serverApi().updateKeyGrants(id, {
        projectIds: options.projects ?? [],
        organizationIds: options.organizations ?? [],
        packageScopes: options.scopes ?? [],
      });
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
