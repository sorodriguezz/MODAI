import type { SignaturePolicy } from "@modai/contracts/types";
import { createRegistries, HttpRegistry, loadV1Project, type Registry, type V1Project } from "@modai/core";
import { ApiClient } from "@modai/sdk";
import { loadClientConfig } from "./config.js";
import { tokenFor } from "./connection.js";
import { requireProject } from "./project.js";

export interface ServerProject {
  root: string;
  project: V1Project;
  projectId: string;
  server: string;
  overrides: Record<string, string>;
  signaturePolicy?: SignaturePolicy;
}

const normalize = (url: string) => url.replace(/\/+$/, "");

export function serverProject(root = process.cwd()): ServerProject {
  const project = loadV1Project(requireProject(root));
  const { projectId } = project.file.context;
  const server = project.file.context.server ?? loadClientConfig()?.server;
  if (!projectId || !server)
    throw new Error(
      "Los agentes trabajan sobre un proyecto del servidor: ejecuta 'modai init --project <id>' o define context.projectId y context.server en modai.yaml",
    );
  return {
    root: project.root,
    project,
    projectId,
    server: normalize(server),
    overrides: project.file.overrides,
    signaturePolicy: project.file.signaturePolicy,
  };
}

export function serverClient(target: ServerProject): ApiClient {
  return new ApiClient(target.server, tokenFor(target.server));
}

export function registriesWithApi(target: ServerProject, api: ApiClient): Registry[] {
  const sources = target.project.file.registries;
  if (!sources.some((source) => source.url && normalize(source.url) === target.server)) {
    throw new Error(
      `El servidor ${target.server} no es un registry de este proyecto. Añádelo con: modai registry add central ${target.server}`,
    );
  }
  return sources.map((source) =>
    source.url && normalize(source.url) === target.server
      ? new HttpRegistry(source.url, undefined, api)
      : createRegistries(target.root, [source], tokenFor)[0],
  );
}
