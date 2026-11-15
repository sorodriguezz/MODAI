import {
  parseInput,
  profileKnowledgeSchema,
  profilePlatformSchema,
  profileVectorSchema,
} from "@modai/contracts/schemas";
import type { EffectiveProfile } from "@modai/contracts/types";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { Services } from "../services.js";
import { projectContextKnowledge } from "./knowledge-scope.js";

type ProjectRequest = FastifyRequest<{ Params: { id: string } }>;

async function projectSearchScope(
  { authz, projects, profiles }: Services,
  request: ProjectRequest,
  input: { packageNames?: string[]; packageVersions?: EffectiveProfile["packages"]; platform?: NodeJS.Platform },
) {
  const actor = authz.require(identityOf(request), "reader");
  const project = await projects.requireProject(actor, request.params.id);
  const pins = input.packageVersions ?? (await profiles.resolve(actor, project, input.platform)).packages;
  const selected = input.packageNames && new Set(input.packageNames);
  const packages = selected ? pins.filter((item) => selected.has(item.name)) : pins;
  return projectContextKnowledge(project.id, packages, authz.packageVisibility(actor), !selected);
}

export function projectKnowledgeSearchRoutes(app: FastifyInstance, services: Services): void {
  app.get<{ Params: { id: string; documentId: string }; Querystring: { platform?: string } }>(
    "/api/v1/projects/:id/knowledge/context/:documentId",
    async (request, reply) => {
      const platform = parseInput(profilePlatformSchema, request.query.platform);
      const scope = await projectSearchScope(services, request, { platform });
      reply.header("Cache-Control", "private, no-store");
      return { document: await services.knowledge.get(request.params.documentId, scope) };
    },
  );
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/knowledge/search", async (request, reply) => {
    const input = parseInput(profileKnowledgeSchema, request.body);
    const scope = await projectSearchScope(services, request, input);
    reply.header("Cache-Control", "private, no-store");
    return { results: await services.knowledge.search({ query: input.query, limit: input.limit }, scope) };
  });
  app.post<{ Params: { id: string } }>("/api/v1/projects/:id/knowledge/vector-search", async (request, reply) => {
    const input = parseInput(profileVectorSchema, request.body);
    const scope = await projectSearchScope(services, request, input);
    reply.header("Cache-Control", "private, no-store");
    return {
      results: await services.knowledge.vectorSearch(input.embedding, input.model, input.limit, undefined, scope),
    };
  });
}
