import { isAbsolute, join, relative, resolve } from "node:path";
import type { RegistrySource } from "@modai/contracts/manifest";
import {
  CompositeRegistry,
  configDirectory,
  createRegistries,
  HttpRegistry,
  LocalRegistry,
  type Registry,
  type V1Project,
} from "@modai/core";
import { loadClientConfig } from "./config.js";
import { effectiveConnection, tokenFor } from "./connection.js";
import { currentProject } from "./project.js";

export function defaultLocalRegistry(): string {
  return join(configDirectory(), "registry");
}

export function registryFromArgument(value: string, project?: V1Project): Registry {
  const named = project?.file.registries.find((item) => item.name === value);
  if (named) return createRegistries(project!.root, [named], tokenFor)[0];
  if (/^https?:\/\//.test(value)) return new HttpRegistry(value, tokenFor(value));
  return new LocalRegistry(resolve(value));
}

export function registrySource(name: string, value: string, root: string): RegistrySource {
  if (/^https?:\/\//.test(value)) return { name, url: value.replace(/\/+$/, "") };
  const absolute = resolve(value);
  const relation = relative(root, absolute);
  return { name, path: relation && !relation.startsWith("..") && !isAbsolute(relation) ? relation : absolute };
}

export function projectRegistry(project: V1Project): CompositeRegistry {
  return new CompositeRegistry(createRegistries(project.root, project.file.registries, tokenFor));
}

export function availableRegistry(options: { registry?: string }): Registry {
  const project = currentProject();
  if (options.registry) return registryFromArgument(options.registry, project);
  if (project) return projectRegistry(project);
  const server = process.env.MODAI_SERVER || loadClientConfig()?.server;
  return server ? new HttpRegistry(server, tokenFor(server)) : new LocalRegistry(defaultLocalRegistry());
}

export function lookupRegistry(root: string): Registry {
  const project = currentProject(root);
  if (project) return projectRegistry(project);
  const { server } = effectiveConnection();
  return new HttpRegistry(server, tokenFor(server));
}
