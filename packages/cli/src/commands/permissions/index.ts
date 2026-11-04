import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { signaturePolicySchema } from "@modai/contracts/schemas";
import { publicKeyFingerprint } from "@modai/contracts/security";
import type { Command } from "commander";
import { loadClientConfig, saveClientConfig } from "../../services/config.js";
import { group } from "../../terminal/help-sections.js";
import type { Print } from "../../terminal/output.js";
import { registerPermissionsGrant, registerPermissionsList, registerPermissionsRevoke } from "./grants.js";

function connectedConfig() {
  const config = loadClientConfig();
  if (!config) throw new Error("Conecta primero la CLI: modai server connect <url>");
  return config;
}

function registerPermissionsTrust(permissions: Command, print: Print): void {
  permissions
    .command("trust")
    .argument("<public-key>", "Clave pública Ed25519 que se autoriza en este equipo")
    .description("Confía en un publicador para la política de firmas 'trusted'")
    .action((path: string) => {
      const config = connectedConfig();
      const fingerprint = publicKeyFingerprint(readFileSync(resolve(path), "utf8"));
      config.trustedPublishers = [...new Set([...(config.trustedPublishers ?? []), fingerprint])];
      saveClientConfig(config);
      print({ trustedPublisher: fingerprint });
    });
  permissions
    .command("signatures")
    .argument("<policy>", "optional, signed o trusted")
    .description("Política de firmas de este equipo")
    .action((value: string) => {
      const config = connectedConfig();
      config.signaturePolicy = signaturePolicySchema.parse(value);
      saveClientConfig(config);
      print({ signaturePolicy: config.signaturePolicy });
    });
}

export function registerPermissionsCommands(program: Command, print: Print): void {
  const permissions = group(
    program,
    "permissions",
    "Qué permite este equipo: herramientas autorizadas, publicadores de confianza y política de firmas",
  );
  registerPermissionsList(permissions, print);
  registerPermissionsGrant(permissions, print);
  registerPermissionsRevoke(permissions, print);
  registerPermissionsTrust(permissions, print);
}
