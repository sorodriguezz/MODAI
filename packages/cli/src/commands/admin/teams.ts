import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import type { Print } from "../../terminal/output.js";

export function registerAdminTeams(admin: Command, print: Print): void {
  const teams = admin.command("team").description("Equipos y miembros de una organización");
  teams
    .command("list <organization>")
    .description("Lista los equipos")
    .action(async (organization: string) => print(await serverApi().teams(organization)));
  teams
    .command("create <organization> <name>")
    .description("Crea un equipo")
    .action(async (organization: string, name: string) => print(await serverApi().createTeam(organization, name)));
  teams
    .command("delete <id>")
    .description("Elimina un equipo y sus asignaciones")
    .action(async (id: string) => {
      await serverApi().deleteTeam(id);
      print(`Equipo eliminado: ${id}`);
    });
  teams
    .command("members <id>")
    .description("Lista los miembros")
    .action(async (id: string) => print(await serverApi().teamMembers(id)));
  for (const active of [true, false]) {
    teams
      .command(`${active ? "add-member" : "remove-member"} <id> <user-id>`)
      .description(active ? "Agrega a un miembro de la organización" : "Retira a un miembro del equipo")
      .action(async (id: string, userId: string) => {
        await serverApi().setTeamMember(id, userId, active);
        print(active ? `Miembro agregado: ${userId}` : `Miembro retirado: ${userId}`);
      });
  }
}
