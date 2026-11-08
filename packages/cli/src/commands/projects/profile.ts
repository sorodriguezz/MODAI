import type { BindingTarget } from "@modai/contracts/types";
import { type Command, Option } from "commander";
import { profileConnection } from "../../services/profile.js";
import type { Print } from "../../terminal/output.js";

type TargetOptions = { scope: BindingTarget["scope"] };

function scoped(command: Command) {
  return command.addOption(
    new Option("--scope <scope>", "Ámbito de la asignación")
      .choices(["organization", "team", "project"])
      .default("project"),
  );
}

export function registerProjectProfile(project: Command, print: Print): void {
  project
    .command("profile [id]")
    .description("Muestra el perfil efectivo y las versiones fijadas para un proyecto")
    .action(async (id?: string) => {
      const { id: projectId, api, platform } = profileConnection(id);
      print(await api.effectiveProfile(projectId, platform));
    });

  scoped(project.command("bindings <id>"))
    .description("Lista las asignaciones directas de un proyecto, equipo u organización")
    .action(async (id: string, { scope }: TargetOptions) =>
      print(await profileConnection(id).api.bindings({ scope, id })),
    );

  scoped(project.command("bind <id> <package>"))
    .description("Asigna un paquete o perfil de paquetes a un ámbito")
    .requiredOption("--range <semver>", "Versión o rango SemVer")
    .option("--slot <id>", "Identificador de la decisión; por defecto el nombre del paquete")
    .option("--required", "Hace obligatoria esta asignación")
    .option("--reason <text>", "Justificación de una excepción")
    .option("--review-at <date>", "Fecha de revisión ISO en UTC")
    .action(
      async (
        id: string,
        packageName: string,
        options: TargetOptions & {
          range: string;
          slot?: string;
          required?: boolean;
          reason?: string;
          reviewAt?: string;
        },
      ) => {
        const { scope, range, slot, required, reason, reviewAt } = options;
        if (Boolean(reason) !== Boolean(reviewAt)) throw new Error("La excepción requiere --reason y --review-at");
        const exception = reason && reviewAt ? { reason, reviewAt } : undefined;
        print(
          await profileConnection(id).api.setBinding({ scope, id }, { packageName, range, slot, required, exception }),
        );
      },
    );

  scoped(project.command("unbind <id> <slot>"))
    .description("Retira una asignación del ámbito seleccionado")
    .action(async (id: string, slot: string, { scope }: TargetOptions) => {
      await profileConnection(id).api.deleteBinding({ scope, id }, slot);
      print(`Asignación retirada: ${slot}`);
    });
}
