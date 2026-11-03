import semver from "semver";
import { normalizeManifest } from "../packages/normalize.js";
import type { Registry } from "../registries/registry.js";

function providedBy(manifest: unknown, capability: string) {
  try {
    return normalizeManifest(manifest).spec.provides.find((entry) => entry.capability === capability);
  } catch {
    return undefined;
  }
}

export async function suggestProviders(
  registry: Registry,
  capability: string,
): Promise<Array<{ name: string; version: string; provides: string }>> {
  const result: Array<{ name: string; version: string; provides: string }> = [];
  for (const item of await registry.list()) {
    const provided = providedBy(item.manifest, capability);
    if (provided)
      result.push({ name: item.name, version: item.version, provides: `${provided.capability}@${provided.version}` });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name) || semver.rcompare(a.version, b.version));
}
