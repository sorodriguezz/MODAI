import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import type { Print } from "../../terminal/output.js";

type PruneOptions = { memoryDays?: string; auditDays?: string; dryRun?: boolean };

function retention(value: string | undefined, neither: boolean, fallback: number): number | undefined {
  if (neither) return fallback;
  return value === undefined ? undefined : Number(value);
}

export function registerAdminPrune(admin: Command, print: Print): void {
  admin
    .command("prune")
    .description(
      "Borra memorias y/o eventos de auditoría antiguos (sin opciones: memorias de más de 365 días y auditoría de más de 90)",
    )
    .option("--memory-days <days>", "Borra memorias sin cambios hace más de N días (0 = todas)")
    .option("--audit-days <days>", "Borra eventos de auditoría de hace más de N días (0 = todos)")
    .option("--dry-run", "Solo cuenta lo que se borraría")
    .action(async (options: PruneOptions) => {
      const neither = options.memoryDays === undefined && options.auditDays === undefined;
      const result = await serverApi().prune(
        retention(options.memoryDays, neither, 365),
        retention(options.auditDays, neither, 90),
        options.dryRun,
      );
      print(
        `${result.dryRun ? "Se borrarían" : "Borrados"}: ${result.memories} memorias y ${result.audit} eventos de auditoría.`,
      );
    });
}

export function registerAdminAudit(admin: Command, print: Print): void {
  admin
    .command("audit")
    .description("Últimos eventos de auditoría")
    .option("--limit <n>", "Cantidad", "50")
    .action(async (options: { limit: string }) =>
      print(
        (await serverApi().audit(Number(options.limit))).map((event) => ({
          when: event.createdAt,
          actor: event.actor,
          action: event.action,
          resource: event.resource,
        })),
      ),
    );
}
