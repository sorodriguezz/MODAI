import type { Command } from "commander";
import type { Print } from "../../terminal/output.js";
import { registerServerConnect } from "./connect.js";
import { registerServerPing } from "./ping.js";
import { registerServerKeys, registerServerLogout, registerServerWhoami } from "./session.js";

export function registerServerCommands(program: Command, print: Print): void {
  const server = program
    .command("server")
    .description("Conexión con un servidor MODAI: conectar, comprobar y cerrar sesión");
  registerServerConnect(server, print);
  registerServerLogout(server, print);
  registerServerKeys(server, print);
  registerServerWhoami(server, print);
  registerServerPing(server, print, program.version()!);
}
