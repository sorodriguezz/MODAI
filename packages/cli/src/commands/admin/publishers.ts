import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import type { Print } from "../../terminal/output.js";

export function registerAdminTrustPublisher(admin: Command, print: Print): void {
  admin
    .command("trust-publisher")
    .description("Registra la clave pública de un publicador como de confianza (política trusted)")
    .argument("<public-key>", "Archivo .pem con la clave pública")
    .option("--label <label>", "Nombre del publicador", "publisher")
    .action(async (path: string, options: { label: string }) =>
      print(await serverApi().registerPublisher(readFileSync(resolve(path), "utf8"), options.label, true)),
    );
}

export function registerAdminPublishers(admin: Command, print: Print): void {
  admin
    .command("publishers")
    .description("Publicadores conocidos por el servidor y si son de confianza")
    .action(async () =>
      print(
        (await serverApi().publishers()).map((item) => ({
          fingerprint: item.fingerprint,
          label: item.label ?? "",
          trusted: item.trusted ? "sí" : "no",
          created: item.createdAt,
        })),
      ),
    );
}

export function registerAdminUntrustPublisher(admin: Command, print: Print): void {
  admin
    .command("untrust-publisher")
    .description("Quita la confianza a un publicador: con la política trusted, sus paquetes nuevos se rechazan")
    .argument("<fingerprint>", "Huella del publicador (modai admin publishers)")
    .action(async (fingerprint: string) => {
      await serverApi().setPublisherTrust(fingerprint, false);
      print(`Publicador ${fingerprint} ya no es de confianza.`);
    });
}
