import type { ProjectFile } from "@modai/contracts/manifest";
import type { CompositeRegistry } from "../registries/composite-registry.js";
import { CapabilityError, type Resolution, type ResolveSource, resolve } from "../resolution/resolver.js";
import type { WorkspaceRef } from "./file-dependencies.js";
import { suggestProviders } from "./provider-suggestions.js";

async function withProviderSuggestions(error: CapabilityError, registry: CompositeRegistry): Promise<CapabilityError> {
  const capability = (error.details as { capability: string }).capability;
  const suggestions = await suggestProviders(registry, capability).catch(() => []);
  const hint = suggestions.length
    ? ` Paquetes que la proporcionan: ${suggestions.map((item) => `${item.name}@${item.version}`).join(", ")}. Instala uno con modai add <paquete>.`
    : " Ningún registry configurado la proporciona.";
  return new CapabilityError(409, error.code, `${error.message}.${hint}`, {
    ...(error.details as object),
    suggestions,
  });
}

export async function resolveWorkspace(
  source: ResolveSource<WorkspaceRef>,
  registry: CompositeRegistry,
  file: ProjectFile,
  roots: Array<{ name: string; range: string }>,
  locked: Record<string, string>,
): Promise<Resolution<WorkspaceRef>> {
  try {
    return await resolve(source, {
      roots,
      overrides: file.overrides,
      providers: file.providers,
      locked,
      features: file.features,
    });
  } catch (error) {
    if (error instanceof CapabilityError && error.code === "CAPABILITY_UNSATISFIED")
      throw await withProviderSuggestions(error, registry);
    throw error;
  }
}
