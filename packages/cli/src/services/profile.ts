import type { ProjectFile } from "@modai/contracts/manifest";
import type { Registry } from "@modai/core";
import { ApiClient } from "@modai/sdk";
import { serverApi, tokenFor } from "./connection.js";
import { ProfileRegistry } from "./profile-registry.js";
import { currentProject } from "./project.js";

export function profileConnection(projectId?: string, context = currentProject()?.file.context) {
  const id = projectId ?? context?.projectId;
  if (!id) throw new Error("Indica un proyecto del servidor o configura context.projectId en modai.yaml");
  const server = context?.server;
  const api = server ? new ApiClient(server, tokenFor(server)) : serverApi();
  const platform = ["win32", "linux", "darwin"].includes(process.platform) ? process.platform : undefined;
  return { id, api, platform };
}

export async function withMaterializedProfile(file: ProjectFile, registries: Registry[]) {
  const { context } = file;
  if (context.delivery !== "materialized") return { file, registries, profileDigest: undefined };
  const { id, api, platform } = profileConnection(undefined, context);
  const profile = await api.effectiveProfile(id, platform);
  const dependencies = { ...file.dependencies };
  const providers = { ...file.providers };
  for (const { name } of profile.packages) {
    if (dependencies[name]?.startsWith("file:") || Object.keys(file.features[name] ?? {}).length)
      throw new Error(`El perfil central fija ${name}. Quita su dependencia file: o sus features locales.`);
  }
  for (const binding of profile.bindings) dependencies[binding.packageName] ??= binding.range;
  for (const [capability, { provider }] of Object.entries(profile.capabilities)) {
    if (providers[capability] && providers[capability] !== provider)
      throw new Error(`El perfil central exige ${provider} como proveedor de ${capability}`);
    providers[capability] = provider;
  }
  return {
    file: { ...file, dependencies, providers },
    registries: [new ProfileRegistry(context.server!, api, profile, registries)],
    profileDigest: profile.digest,
  };
}

export function searchProfileKnowledge(
  query: string,
  options: {
    projectId?: string;
    context?: ProjectFile["context"];
    packages?: string[];
    limit?: number;
  },
) {
  const { id, api, platform } = profileConnection(options.projectId, options.context);
  return api.searchProjectKnowledge(id, { query, platform, packageNames: options.packages, limit: options.limit });
}
