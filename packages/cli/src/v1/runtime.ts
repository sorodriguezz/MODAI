import { askConfirm, interactive } from "../cli/ui.js";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ApiClient } from "@modai/sdk";
import type { ProjectFile, RegistrySource } from "@modai/contracts/spec-v1";
import type { SignaturePolicy } from "@modai/contracts/types";
import {
  CompositeRegistry, FileMemoryStore, HttpRegistry, LocalMemoryProvider, LocalRegistry, configDirectory, createRegistries, isV1Project, loadGrants,
  loadV1Project, saveGrants, saveProjectFile, syncWorkspace, type MemoryProvider, type Registry, type SyncOptions, type SyncReport, type V1Project,
} from "@modai/core";
import { loadClientConfig } from "../cli/config.js";
import { effectiveConnection } from "../cli/connection.js";

export function tokenFor(url: string): string | undefined {
  // No server configured means no credential; refusing to send one over plain http must reach the person.
  try { return effectiveConnection(url).token; } catch (error) { if ((error as Error).message.startsWith("No se envían credenciales")) throw error; return undefined; }
}

export function defaultLocalRegistry(): string { return join(configDirectory(), "registry"); }

/** Interprets a --registry value: a configured registry name, an http(s) URL or a folder. */
export function registryFromArgument(value: string, project?: V1Project): Registry {
  const named = project?.file.registries.find(item => item.name === value);
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

export function trustPolicy(file: ProjectFile): SyncOptions["trust"] {
  const order: SignaturePolicy[] = ["optional", "signed", "trusted"];
  const config = loadClientConfig();
  const rank = Math.max(order.indexOf(config?.signaturePolicy ?? "optional"), order.indexOf(file.signaturePolicy ?? "optional"));
  return { policy: order[Math.max(rank, 0)], trustedPublishers: config?.trustedPublishers ?? [] };
}

/** Root of a MODAI project, or a clear error. */
export function requireV1Project(root = process.cwd()): string {
  if (isV1Project(root)) return resolve(root);
  throw new Error("No es un proyecto MODAI: ejecuta 'modai init'.");
}

export interface RunSyncOptions { allow?: string[]; update?: boolean | string[]; frozen?: boolean; force?: boolean; keepMine?: boolean; registries?: Registry[] }

/** Applies an optional change to modai.yaml and converges the project. modai.yaml is only saved if the sync succeeds. */
export async function runSync(root: string, change?: (file: ProjectFile) => void, options: RunSyncOptions = {}): Promise<{ report: SyncReport; project: V1Project }> {
  const project = loadV1Project(requireV1Project(root));
  const file = structuredClone(project.file);
  change?.(file);
  const grants = loadGrants(project.root);
  const install = [...new Set([...grants.install, ...(options.allow ?? [])])];
  const next = { ...project, file };
  const report = await syncWorkspace(next, {
    registries: options.registries ?? createRegistries(project.root, file.registries, tokenFor), grants: install, trust: trustPolicy(file),
    update: options.update, frozen: options.frozen, force: options.force, keepMine: options.keepMine,
  });
  if (change) saveProjectFile(project.root, file);
  if (options.allow?.length) saveGrants(project.root, { ...loadGrants(project.root), install });
  if (!options.frozen) await reportInstallations(file, report);
  return { report, project: { ...next, lock: report.lock } };
}

/**
 * Best effort: a project linked to a server (context.projectId) tells it what is installed, so the
 * panel can show which projects use each package. It never blocks or fails an installation.
 * Opt out with MODAI_NO_USAGE_REPORT=1.
 */
async function reportInstallations(file: ProjectFile, report: SyncReport): Promise<void> {
  const { projectId, server } = file.context;
  if (!projectId || !server || process.env.MODAI_NO_USAGE_REPORT) return;
  const packages = Object.entries(report.lock.packages).map(([name, item]) => ({ name, version: item.version, direct: name in file.dependencies }));
  try { await new ApiClient(server, tokenFor(server)).reportInstallations(projectId, packages, AbortSignal.timeout(3000)); } catch { /* the server may be down or the key may lack access: not the user's problem now */ }
}

export function summarize(report: SyncReport): string {
  const lines = [`${report.installed.length} paquete(s) instalados${report.installed.length ? `: ${report.installed.map(item => `${item.name}@${item.version}`).join(", ")}` : ""}.`];
  if (report.written.length) {
    const groups = new Map<string, number>();
    for (const path of report.written) { const key = path.match(/^(\.[^/]+\/skills\/[^/]+|[^/]+)/)?.[1] ?? path; groups.set(key, (groups.get(key) ?? 0) + 1); }
    lines.push(`Escritos: ${[...groups].map(([key, count]) => count > 1 ? `${key}/ (${count})` : key).join(", ")}`);
  }
  if (report.removed.length) lines.push(`Retirados: ${report.removed.join(", ")}`);
  if (report.preserved.length) lines.push(`Conservados (cambios del usuario): ${report.preserved.join(", ")}`);
  if (report.sideBySide.length) lines.push(`Conservé tu versión; la nueva quedó al lado para que la compares: ${report.sideBySide.join(", ")}`);
  for (const warning of report.warnings) lines.push(`Aviso: ${warning}`);
  for (const item of report.missingOptional) lines.push(`Opcional sin proveedor: ${item.package} puede usar ${item.capability}@${item.range}`);
  if (report.regrant.length) lines.push(`Requieren nueva autorización (cambió su contenido o sus features): ${report.regrant.map(name => `modai permissions grant ${name}`).join("; ")}`);
  return lines.join("\n");
}

class RemoteMemoryProvider implements MemoryProvider {
  constructor(private readonly api: ApiClient, private readonly projectId: string) {}
  remember(input: { content: string; kind?: string }) { return this.api.remember({ projectId: this.projectId, content: input.content, kind: input.kind ?? "note" }); }
  recall(query: string) { return this.api.recall(this.projectId, query); }
  list() { return this.api.listMemories(this.projectId); }
  forget(id: string) { return this.api.deleteMemory(id); }
}

/** Memory is a pluggable provider: local files by default, or a MODAI server shared by a team. */
export function memoryProvider(project: V1Project): MemoryProvider | undefined {
  const context = project.file.context;
  if (context.memory === "off") return undefined;
  if (context.memory === "remote") {
    if (!context.server || !context.projectId) throw new Error("context.memory=remote requiere context.server y context.projectId en modai.yaml");
    return new RemoteMemoryProvider(new ApiClient(context.server, tokenFor(context.server)), context.projectId);
  }
  return new LocalMemoryProvider(new FileMemoryStore(join(project.root, ".modai", "memory.jsonl"), "project"), new FileMemoryStore(join(configDirectory(), "memory.jsonl"), "user"));
}

export async function confirm(question: string, assumeYes?: boolean): Promise<boolean> {
  if (assumeYes) return true;
  if (!interactive()) throw new Error("Confirmación requerida: repite con --yes en entornos no interactivos");
  return askConfirm(question);
}
