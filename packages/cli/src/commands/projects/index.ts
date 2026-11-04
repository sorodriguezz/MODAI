import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { isJsonMode, type Print } from "../../terminal/output.js";
import { confirmAction } from "../../terminal/prompts.js";
import { shellQuote } from "../../terminal/shell.js";

type UpdateOptions = { name?: string; organization?: string | false };

function projectChanges(options: UpdateOptions) {
  const organization =
    options.organization === false
      ? { organizationId: null }
      : options.organization
        ? { organizationId: options.organization }
        : {};
  return { ...(options.name ? { name: options.name } : {}), ...organization };
}

function registerProjectsList(project: Command, print: Print): void {
  project
    .command("list", { isDefault: true })
    .alias("ls")
    .description("Proyectos a los que tienes acceso")
    .action(async () => {
      print(
        (await serverApi().projects()).map((item) => ({
          id: item.id,
          name: item.name,
          organization: item.organizationId ?? "",
          created: item.createdAt,
        })),
      );
    });
}

function registerProjectsCreate(project: Command, print: Print): void {
  project
    .command("create")
    .description("Crea un proyecto en el servidor")
    .requiredOption("--name <name>", "Nombre visible")
    .option("--id <id>", "Identificador; por defecto se genera uno")
    .option("--organization <id>", "Organización para compartir memoria")
    .action(async (options: { name: string; id?: string; organization?: string }) => {
      const created = await serverApi().createProject({
        id: options.id,
        name: options.name,
        organizationId: options.organization,
      });
      print(
        isJsonMode()
          ? created
          : `Proyecto ${created.name} creado (${created.id}).\nVincula un repositorio con: modai init --project ${shellQuote(created.id)}`,
      );
    });
}

function registerProjectsUpdate(project: Command, print: Print): void {
  project
    .command("update")
    .description("Renombra un proyecto o cambia su organización")
    .argument("<id>", "Identificador del proyecto")
    .option("--name <name>", "Nombre visible nuevo")
    .option("--organization <id>", "Organización (para compartir memoria de organización)")
    .option("--no-organization", "Quita la organización")
    .action(async (id: string, options: UpdateOptions) => {
      const input = projectChanges(options);
      if (!Object.keys(input).length) throw new Error("Indica qué cambiar: --name, --organization o --no-organization");
      const updated = await serverApi().updateProject(id, input);
      print(isJsonMode() ? updated : `Proyecto ${updated.name} (${updated.id}) actualizado.`);
    });
}

function registerProjectsDelete(project: Command, print: Print): void {
  project
    .command("delete")
    .alias("rm")
    .description("Elimina un proyecto con su memoria, ejecuciones y registro de instalaciones (irreversible)")
    .argument("<id>", "Identificador del proyecto")
    .option("--yes", "No pide confirmación (para scripts)")
    .action(async (id: string, options: { yes?: boolean }) => {
      const api = serverApi();
      const found = (await api.projects()).find((item) => item.id === id);
      if (!found)
        throw new Error(
          `No existe el proyecto ${id} o no tienes acceso. Revisa los identificadores con: modai project list`,
        );
      if (found.canDelete === false)
        throw new Error(`No puedes eliminar ${found.name}: solo un administrador o quien lo creó`);
      const question = `Se eliminará ${found.name} (${id}) con su memoria de proyecto, sus ejecuciones y su registro de instalaciones. La memoria de organización se conserva. No se puede deshacer. ¿Continuar?`;
      if (!(await confirmAction(question, options.yes))) {
        print("Sin cambios.");
        return;
      }
      const result = await api.deleteProject(id);
      print(
        isJsonMode()
          ? result
          : `Proyecto ${found.name} eliminado: ${result.memories} memorias y ${result.runs} ejecuciones borradas.\nLos repositorios vinculados conservan sus archivos; quita context.projectId de su modai.yaml o vincúlalos a otro proyecto.`,
      );
    });
}

export function registerProjectsCommands(program: Command, print: Print): void {
  const project = program.command("project").description("Proyectos del servidor: listar, crear, editar y eliminar");
  registerProjectsList(project, print);
  registerProjectsCreate(project, print);
  registerProjectsUpdate(project, print);
  registerProjectsDelete(project, print);
}
