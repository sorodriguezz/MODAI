import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

const organizationTeams = "/api/v1/organizations/:id/teams";
const teamMembers = "/api/v1/teams/:id/members";

export async function teamsRoutes(app: FastifyInstance, { services: { teams, audit } }: ModuleOptions): Promise<void> {
  app.get<{ Params: { id: string } }>(organizationTeams, async (request) => ({
    teams: await teams.list(identityOf(request), request.params.id),
  }));
  app.post<{ Params: { id: string }; Body: { name: string } }>(
    organizationTeams,
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: { name: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" } },
        },
      },
    },
    async (request, reply) => {
      const team = await teams.create(identityOf(request), request.params.id, request.body.name.trim());
      await audit.fromRequest(request, "team.create", team.id, { organizationId: team.organizationId });
      return reply.code(201).send({ team });
    },
  );
  app.delete<{ Params: { id: string } }>("/api/v1/teams/:id", async (request, reply) => {
    await teams.delete(identityOf(request), request.params.id);
    await audit.fromRequest(request, "team.delete", request.params.id);
    return reply.code(204).send();
  });
  app.get<{ Params: { id: string } }>(teamMembers, async (request) => ({
    members: await teams.members(identityOf(request), request.params.id),
  }));
  for (const method of ["PUT", "DELETE"] as const) {
    app.route<{ Params: { id: string; userId: string } }>({
      method,
      url: `${teamMembers}/:userId`,
      async handler(request, reply) {
        const { id, userId } = request.params;
        const active = method === "PUT";
        await teams.setMember(identityOf(request), id, userId, active);
        await audit.fromRequest(request, active ? "team.member.add" : "team.member.remove", id, { userId });
        return reply.code(204).send();
      },
    });
  }
}
