import type { AgentBundle } from "@modai/contracts/types";
import type { ApiClient } from "@modai/sdk";

function queryOf(input: Record<string, unknown>): string {
  if (typeof input.query !== "string" || !input.query.trim()) throw new Error("query es obligatorio");
  return input.query;
}

async function recall(
  api: ApiClient,
  bundle: AgentBundle,
  sessionId: string | undefined,
  input: Record<string, unknown>,
) {
  const scopes = bundle.agent.definition.memory.read;
  if (!scopes.length) return [];
  return api.recall(bundle.projectId, queryOf(input), {
    includeProject: scopes.includes("project"),
    includeOrganization: scopes.includes("organization"),
    sessionId: scopes.includes("session") ? sessionId : undefined,
  });
}

function remember(api: ApiClient, bundle: AgentBundle, input: Record<string, unknown>) {
  if (!bundle.agent.definition.memory.write) throw new Error("La política del agente impide escribir memoria");
  if (typeof input.content !== "string" || !input.content.trim()) throw new Error("content es obligatorio");
  return api.remember({
    projectId: bundle.projectId,
    content: input.content,
    kind: typeof input.kind === "string" ? input.kind : "note",
    scope: "project",
  });
}

export async function invokeBuiltin(
  api: ApiClient,
  bundle: AgentBundle,
  sessionId: string | undefined,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (name === "modai_search_knowledge") {
    const versions = bundle.packages.map(({ name, version }) => ({ name, version }));
    return api.searchKnowledge(
      queryOf(input),
      versions.map(({ name }) => name),
      versions,
    );
  }
  if (name === "modai_recall") return recall(api, bundle, sessionId, input);
  if (name === "modai_remember") return remember(api, bundle, input);
  throw new Error(`Herramienta integrada desconocida: ${name}`);
}
