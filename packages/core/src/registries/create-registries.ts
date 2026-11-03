import { resolve as resolvePath } from "node:path";
import type { RegistrySource } from "@modai/contracts/manifest";
import { HttpRegistry } from "./http-registry.js";
import { LocalRegistry } from "./local-registry.js";
import type { Registry } from "./registry.js";

export function createRegistries(
  root: string,
  sources: RegistrySource[],
  tokenFor: (url: string) => string | undefined,
): Registry[] {
  return sources.map((source) =>
    source.path
      ? new LocalRegistry(resolvePath(root, source.path))
      : new HttpRegistry(source.url!, tokenFor(source.url!)),
  );
}
