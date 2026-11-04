import { BUILTIN_TOOLS } from "@modai/contracts/agent-tools";
import { composeSchema, parseInput } from "@modai/contracts/schemas";
import type { PackageRecord } from "@modai/contracts/types";
import { isAgentPackage, normalizeManifest } from "@modai/core";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

const builtinTools = () =>
  Object.entries(BUILTIN_TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    readOnly: tool.readOnly,
    inputSchema: tool.inputSchema,
  }));

function capabilityContract(item: PackageRecord) {
  try {
    const spec = normalizeManifest(item.manifest).spec;
    return [
      {
        packageName: item.name,
        version: item.version,
        category: spec.category,
        provides: spec.provides,
        requires: spec.requires,
        optional: spec.optional,
        tools: spec.contributes.tools.map((tool) => ({ name: tool.name, implements: tool.implements })),
      },
    ];
  } catch {
    return [];
  }
}

export async function agentsRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { authz, packages, projects, agents } = services;
  app.get("/api/v1/agents", async (request) => {
    const visible = await authz.packageReader(identityOf(request));
    return { agents: (await packages.list()).filter((item) => visible(item.name) && isAgentPackage(item.manifest)) };
  });
  app.get<{ Querystring: { capability?: string } }>("/api/v1/capabilities", async (request) => {
    const visible = await authz.packageReader(identityOf(request));
    const latest = (await packages.list()).filter((item) => visible(item.name));
    const capability = request.query.capability;
    const contracts = latest
      .flatMap(capabilityContract)
      .filter((item) => !capability || item.provides.some((provided) => provided.capability === capability));
    return { builtin: builtinTools(), contracts };
  });
  app.post("/api/v1/agents/compose", async (request) => {
    const input = parseInput(composeSchema, request.body);
    await projects.requireProject(identityOf(request), input.projectId);
    await authz.requireReadPackage(identityOf(request), input.name);
    return { bundle: await agents.compose(input.projectId, input.name, input.range, input.overrides) };
  });
}
