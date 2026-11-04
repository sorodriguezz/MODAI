import { resolve } from "node:path";
import { loadV1Project } from "@modai/core";
import type { Command } from "commander";
import { discoverProjects } from "../../services/workspace.js";
import { commaList } from "../../terminal/options.js";
import { type Print, printList } from "../../terminal/output.js";
import { registerWorkspaceAdd } from "./add.js";
import { registerWorkspaceRemove } from "./remove.js";
import { registerWorkspaceSync } from "./sync.js";
import { registerWorkspaceUpdate } from "./update.js";

function registerWorkspaceList(workspace: Command): void {
  workspace
    .command("list")
    .description("Proyectos MODAI encontrados bajo la raíz")
    .option("--root <dir>", "Carpeta raíz", ".")
    .option("--depth <n>", "Profundidad máxima (0-10)", "4")
    .option("--filter <texts>", "Filtro por ruta", commaList)
    .action((options: { root: string; depth: string; filter?: string[] }) => {
      const projects = discoverProjects(options.root, { depth: Number(options.depth), filter: options.filter });
      printList(
        projects.map((project) => {
          const loaded = loadV1Project(project.root);
          return {
            project: project.path,
            name: loaded.file.name,
            packages: Object.keys(loaded.file.dependencies).join(", "),
          };
        }),
        `No hay proyectos MODAI bajo ${resolve(options.root)}.`,
      );
    });
}

export function registerWorkspaceCommands(program: Command, print: Print): void {
  const workspace = program
    .command("workspace")
    .alias("ws")
    .description("Aplica operaciones a muchos proyectos bajo una raíz (carpeta de repositorios o monorepo)");
  registerWorkspaceList(workspace);
  registerWorkspaceAdd(workspace, print);
  registerWorkspaceRemove(workspace, print);
  registerWorkspaceUpdate(workspace, print);
  registerWorkspaceSync(workspace, print);
}
