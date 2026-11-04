import { existsSync, readFileSync, rmSync } from "node:fs";
import type { PermissionV1 } from "@modai/contracts/manifest";
import type { Activation, AgentBundle } from "@modai/contracts/types";
import { loadV1Project } from "@modai/core";
import { safeProjectPath, writeProjectFile } from "@modai/core/installation/fs";
import type { ApiClient } from "@modai/sdk";
import { localApproval, saveLocalApproval } from "../services/approvals.js";
import { registriesWithApi, type ServerProject, serverProject } from "../services/server-project.js";
import { runSync } from "../services/sync.js";
import { installationPolicy } from "../services/trust.js";
import { agentInstructions, verifyBundle } from "./bundle.js";
import { hostFileOf, removeRouterBlock, writeRouterBlock } from "./host-file.js";

export interface ActivateOptions {
  adapter?: Activation["adapter"];
  grants?: PermissionV1[];
  allowedMcp?: string[];
  allowedEnv?: string[];
}

const INSTALL_GRANTS = ["project.instructions", "project.files", "project.source"];

function readActivation(root: string): Activation | undefined {
  const path = safeProjectPath(root, ".modai/activation.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Activation) : undefined;
}

export function loadActivation(root: string): Activation {
  const activation = readActivation(root);
  if (!activation) throw new Error("Activa un agente con modai agent activate");
  const target = serverProject(root);
  if (
    activation.schemaVersion !== 1 ||
    activation.bundle.projectId !== target.projectId ||
    activation.server !== target.server
  )
    throw new Error("La activación no corresponde al proyecto o servidor actual");
  if (activation.bundle.packages.some((item) => target.project.lock.packages[item.name]?.version !== item.version))
    throw new Error("La activación ya no coincide con modai.lock; vuelve a activar el agente");
  const approval = localApproval(root, target.projectId, activation.server);
  // why: repository files only request capabilities; only machine-local approvals authorize processes
  const approved = approval.digest === activation.bundle.digest;
  activation.allowedMcp = approved ? (approval.allowedMcp ?? []) : [];
  activation.allowedEnv = approved ? (approval.allowedEnv ?? []) : [];
  return activation;
}

function assertAuthorized(bundle: AgentBundle, grants: string[], allowedMcp: string[]): void {
  for (const permission of bundle.permissions)
    if (!grants.includes(permission)) throw new Error(`El agente necesita --allow ${permission}`);
  for (const capability of bundle.capabilities)
    if (capability.kind === "mcp" && !allowedMcp.includes(capability.name))
      throw new Error(`Autoriza el proceso MCP con --allow-mcp ${capability.name}`);
}

function assertWritable(root: string, previous: Activation | undefined): void {
  const instructionPath = safeProjectPath(root, ".modai/agent.md");
  if (
    existsSync(instructionPath) &&
    (!previous || readFileSync(instructionPath, "utf8") !== agentInstructions(previous.bundle))
  )
    throw new Error(".modai/agent.md contiene cambios del usuario");
}

function assertHostFile(target: ServerProject, hostFile: string | undefined, grants: string[]): void {
  if (!hostFile) return;
  if (!grants.includes("project.instructions")) throw new Error("El adaptador requiere --allow project.instructions");
  if (
    target.project.lock.managed.some(
      (entry) => entry.type === "file" && entry.path.toLowerCase() === hostFile.toLowerCase(),
    )
  )
    throw new Error(`Un paquete administra ${hostFile} completo; usa --adapter files y carga el contexto mediante MCP`);
}

async function installAgentPackages(
  target: ServerProject,
  api: ApiClient,
  bundle: AgentBundle,
  name: string,
  overrides: Record<string, string>,
  grants: string[],
): Promise<void> {
  const pinned = Object.fromEntries(bundle.packages.map((item) => [item.name, item.version]));
  await runSync(
    target.root,
    (file) => {
      file.dependencies[name] = bundle.agent.version;
      file.overrides = { ...overrides, ...pinned };
    },
    {
      allow: grants.filter((permission) => INSTALL_GRANTS.includes(permission)),
      registries: registriesWithApi(target, api),
    },
  );
  const lock = loadV1Project(target.root).lock;
  const drift = bundle.packages.filter((item) => lock.packages[item.name]?.version !== item.version);
  if (drift.length)
    throw new Error(
      `Los registries del proyecto resolvieron versiones distintas a las del agente: ${drift.map((item) => `${item.name}@${item.version}`).join(", ")}`,
    );
}

export async function activateAgent(
  api: ApiClient,
  root: string,
  server: string,
  name: string,
  range: string,
  options: ActivateOptions = {},
): Promise<Activation> {
  const target = serverProject(root);
  if (server.replace(/\/+$/, "") !== target.server)
    throw new Error(`El proyecto está vinculado a ${target.server}, no a ${server}`);
  const previous = readActivation(root);
  const overrides = { ...target.overrides };
  for (const item of previous?.bundle.packages ?? [])
    if (overrides[item.name] === item.version) delete overrides[item.name];
  const bundle = await api.composeAgent(target.projectId, name, range, overrides);
  const grants = [
    ...new Set([...localApproval(root, target.projectId, target.server).permissions, ...(options.grants ?? [])]),
  ];
  const allowedMcp = options.allowedMcp ?? [];
  const allowedEnv = options.allowedEnv ?? [];
  assertAuthorized(bundle, grants, allowedMcp);
  await verifyBundle(api, bundle, await installationPolicy(api, target));
  const adapter = options.adapter ?? "files";
  const activation: Activation = { schemaVersion: 1, server: target.server, bundle, adapter, allowedMcp, allowedEnv };
  assertWritable(root, previous);
  const hostFile = hostFileOf(adapter);
  assertHostFile(target, hostFile, grants);
  await installAgentPackages(target, api, bundle, name, overrides, grants);
  writeProjectFile(root, ".modai/agent.md", agentInstructions(bundle));
  writeProjectFile(root, ".modai/activation.json", `${JSON.stringify(activation, null, 2)}\n`);
  if (hostFile) writeRouterBlock(root, hostFile);
  saveLocalApproval(root, target.projectId, target.server, {
    permissions: grants,
    digest: bundle.digest,
    allowedMcp,
    allowedEnv,
  });
  return activation;
}

export function deactivateAgent(root: string): { removed: string[]; preserved: string[] } {
  const activation = readActivation(root);
  if (!activation) return { removed: [], preserved: [] };
  const removed: string[] = [],
    preserved: string[] = [];
  const instructions = safeProjectPath(root, ".modai/agent.md");
  if (existsSync(instructions)) {
    if (readFileSync(instructions, "utf8") === agentInstructions(activation.bundle)) {
      rmSync(instructions);
      removed.push(".modai/agent.md");
    } else preserved.push(".modai/agent.md");
  }
  const host = hostFileOf(activation.adapter);
  if (host && removeRouterBlock(root, host)) preserved.push(host);
  rmSync(safeProjectPath(root, ".modai/activation.json"));
  removed.push(".modai/activation.json");
  const projectId = activation.bundle.projectId;
  saveLocalApproval(root, projectId, activation.server, {
    permissions: localApproval(root, projectId, activation.server).permissions,
  });
  return { removed, preserved };
}
