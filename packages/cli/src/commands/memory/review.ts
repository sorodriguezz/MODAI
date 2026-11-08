import type { Command } from "commander";
import { profileConnection } from "../../services/profile.js";
import type { Print } from "../../terminal/output.js";
import { PROJECT_OPTION } from "./options.js";

export function registerMemoryReview(memory: Command, print: Print): void {
  memory
    .command("pending")
    .description("Lista memorias de organización pendientes o con revisión vencida")
    .option(...PROJECT_OPTION)
    .action(async ({ project }: { project?: string }) => {
      const { api, id } = profileConnection(project);
      print(await api.pendingMemories(id));
    });
  memory
    .command("review <id>")
    .description("Aprueba o rechaza una memoria de organización")
    .option("--approve", "Aprueba la memoria")
    .option("--reject", "Rechaza la memoria")
    .option("--review-at <date>", "Fecha de revisión ISO en UTC")
    .option(...PROJECT_OPTION)
    .action(
      async (id: string, options: { approve?: boolean; reject?: boolean; reviewAt?: string; project?: string }) => {
        if (Boolean(options.approve) === Boolean(options.reject)) throw new Error("Elige --approve o --reject");
        const { api } = profileConnection(options.project ?? id);
        print(await api.reviewMemory(id, Boolean(options.approve), options.reviewAt));
      },
    );
}
