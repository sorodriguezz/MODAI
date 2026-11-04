import { loadV1Project } from "@modai/core";
import type { Command } from "commander";
import { runSync } from "../../services/sync.js";
import type { Print } from "../../terminal/output.js";
import { firstLine, summarize } from "../../terminal/sync-summary.js";
import { type RunOptions, runOnProjects, withRunOptions } from "./run-on-projects.js";

export function registerWorkspaceSync(workspace: Command, print: Print): void {
  withRunOptions(workspace.command("sync").description("Reconstruye cada proyecto desde su modai.yaml y modai.lock"))
    .option("--frozen", "Falla si un modai.lock no corresponde a su modai.yaml (CI)")
    .action(async (options: RunOptions & { frozen?: boolean }) => {
      await runOnProjects(
        {
          describe: "Sincronizar",
          plan: async (project) => ({
            project: project.path,
            result: "pendiente",
            detail: `${Object.keys(loadV1Project(project.root).file.dependencies).length} dependencia(s)`,
          }),
          apply: async (project) =>
            firstLine(summarize((await runSync(project.root, undefined, { frozen: options.frozen })).report)),
        },
        options,
        print,
      );
    });
}
