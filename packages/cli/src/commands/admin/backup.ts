import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import type { Print } from "../../terminal/output.js";

export function registerAdminExport(admin: Command, print: Print): void {
  admin
    .command("export")
    .argument("<file>")
    .action(async (file: string) => {
      writeFileSync(resolve(file), `${JSON.stringify(await serverApi().exportBackup(), null, 2)}\n`, "utf8");
      print(`Backup exportado a ${resolve(file)}`);
    });
}

export function registerAdminImport(admin: Command, print: Print): void {
  admin
    .command("import")
    .argument("<file>")
    .action(async (file: string) =>
      print(await serverApi().importBackup(JSON.parse(readFileSync(resolve(file), "utf8")))),
    );
}
