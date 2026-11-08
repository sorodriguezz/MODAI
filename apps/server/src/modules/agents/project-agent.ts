import { AppError } from "@modai/contracts/errors";
import type { composeSchema } from "@modai/contracts/schemas";
import type { AgentBundle } from "@modai/contracts/types";
import type { Identity } from "../auth/identity.js";
import type { Services } from "../services.js";

type ComposeInput = ReturnType<typeof composeSchema.parse>;

export async function composeProjectAgent(
  { authz, projects, profiles, agents, executionPolicies }: Services,
  actor: Identity,
  input: ComposeInput,
  write = false,
): Promise<AgentBundle> {
  const project = await projects.requireProject(actor, input.projectId, write);
  const [profile, visible, policy] = await Promise.all([
    profiles.resolve(actor, project),
    authz.packageReader(actor),
    executionPolicies.get(project.id),
  ]);
  const bundle = await agents.compose(project.id, input.name, input.range, input.overrides, visible, {
    profile,
    policy,
  });
  if (
    bundle.capabilities.some((tool) => tool.name === "modai_recall") &&
    bundle.agent.definition.memory.read.includes("organization") &&
    (!project.organizationId || (actor.role !== "admin" && !actor.organizationIds.includes(project.organizationId)))
  )
    throw new AppError(
      403,
      "ORGANIZATION_FORBIDDEN",
      "La identidad no puede autorizar lectura de memoria de organización",
    );
  return bundle;
}
