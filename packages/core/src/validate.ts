import semver from "semver";
import { AppError, invariant } from "@modai/contracts/errors";
import { assertSafeRelativePath, requiredTargetPermission, sha256 } from "@modai/contracts/security";
import { isBuiltinTool } from "@modai/contracts/agent-tools";
import type { ArtifactFile, PackageManifest } from "@modai/contracts/types";
import type { PackageManifestV1 } from "@modai/contracts/spec-v1";
import { normalizeManifest } from "./normalize.js";
import { adapterTargetPermission, componentTargetPermission, expandTemplate } from "./targets.js";

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export function skillFiles(skill: { path: string; files?: string[] }, paths: Iterable<string>): Array<{ source: string; relative: string }> {
  const base = skill.path === "." ? "" : `${skill.path.replace(/\/$/, "")}/`;
  if (skill.files) return skill.files.map(relative => ({ source: `${base}${relative}`, relative }));
  return [...paths].filter(path => path.startsWith(base)).map(source => ({ source, relative: source.slice(base.length) })).sort((a, b) => a.source.localeCompare(b.source));
}

/** Files of a component: every package file under `path`, mapped under the expanded `target`. */
export function componentFiles(component: { name: string; path: string; target: string }, packageName: string, paths: Iterable<string>): Array<{ source: string; target: string }> {
  const base = component.path === "." ? "" : `${component.path.replace(/\/$/, "")}/`;
  const directory = expandTemplate(component.target, { component: component.name, package: packageName }).replace(/\/$/, "");
  return [...paths]
    .filter(path => path.startsWith(base) && path !== "modai.package.yaml")
    .map(source => ({ source, target: `${directory}/${source.slice(base.length)}` }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

/** References in tool/MCP args of the form ${packageDir}/relative/path. */
export function packageFileReferences(args: string[]): string[] {
  return args.flatMap(arg => [...arg.matchAll(/\$\{packageDir\}\/([^\s"']+)/g)].map(match => match[1]));
}

/**
 * Structural validation shared by the CLI, local registries and the central server.
 * It checks contracts, never categories: a "testing" or "frontend" package is validated
 * exactly like any other.
 */
export function validatePackage(raw: PackageManifest, files: ArtifactFile[]): PackageManifestV1 {
  const manifest = normalizeManifest(raw);
  const declared = new Set<string>(manifest.spec.permissions);
  const requirePermission = (permission: string, reason: string) =>
    invariant(declared.has(permission), 400, "PERMISSION_UNDECLARED", `${reason} requiere declarar el permiso ${permission}`);

  invariant(Array.isArray(files), 400, "INVALID_ARTIFACT", "files debe ser una lista");
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    assertSafeRelativePath(file.path, "files.path");
    invariant(!paths.has(file.path), 400, "DUPLICATE_FILE", `Archivo duplicado: ${file.path}`);
    paths.add(file.path);
    const decoded = Buffer.from(file.content, "base64");
    total += decoded.byteLength;
    invariant(sha256(decoded) === file.sha256, 400, "HASH_MISMATCH", `Hash incorrecto para ${file.path}`);
  }
  invariant(total <= MAX_ARTIFACT_BYTES, 413, "ARTIFACT_TOO_LARGE", "El artefacto supera 25 MiB");
  const exists = (path: string, label: string) => { assertSafeRelativePath(path, label); invariant(paths.has(path), 400, "MISSING_SOURCE", `No existe el archivo fuente ${path}`); };

  const { spec } = manifest;
  for (const [name, range] of Object.entries(spec.dependencies)) {
    invariant(Boolean(semver.validRange(range)), 400, "INVALID_DEPENDENCY", `Dependencia inválida: ${name}@${range}`);
    invariant(name !== manifest.metadata.name, 400, "INVALID_DEPENDENCY", "Un paquete no puede depender de sí mismo");
  }
  for (const requirement of [...spec.requires, ...spec.optional]) {
    invariant(Boolean(semver.validRange(requirement.version)), 400, "INVALID_CAPABILITY_RANGE", `Rango inválido para ${requirement.capability}: ${requirement.version}`);
  }
  const provided = new Set<string>();
  for (const capability of spec.provides) {
    invariant(!provided.has(capability.capability), 400, "DUPLICATE_CAPABILITY", `Capacidad duplicada: ${capability.capability}`);
    provided.add(capability.capability);
  }

  const { contributes } = spec;
  const unique = (kind: string, names: string[]) => {
    const seen = new Set<string>();
    for (const name of names) { invariant(!seen.has(name), 400, "DUPLICATE_CONTRIBUTION", `${kind} duplicado: ${name}`); seen.add(name); }
  };
  unique("Skill", contributes.skills.map(item => item.name));
  unique("Regla", contributes.rules.map(item => item.name));
  unique("Herramienta", contributes.tools.map(item => item.name));
  unique("Servidor MCP", contributes.mcpServers.map(item => item.name));
  unique("Componente", contributes.components.map(item => item.name));
  for (const component of contributes.components) {
    assertSafeRelativePath(component.path, "components.path");
    const entries = componentFiles(component, manifest.metadata.name, paths);
    invariant(entries.length > 0, 400, "COMPONENT_EMPTY", `El componente ${component.name} no tiene archivos en ${component.path}`);
    for (const entry of entries) componentTargetPermission(entry.target);
    requirePermission("project.source", `El componente ${component.name}`);
  }
  for (const skill of contributes.skills) {
    const entries = skillFiles(skill, paths);
    invariant(entries.some(entry => entry.relative === "SKILL.md"), 400, "SKILL_ENTRYPOINT_MISSING", `La skill ${skill.name} necesita ${skill.path}/SKILL.md`);
    for (const entry of entries) exists(entry.source, "skills.path");
  }
  for (const rule of contributes.rules) exists(rule.path, "rules.path");
  for (const item of contributes.knowledge) exists(item.path, "knowledge.path");
  for (const path of spec.include) invariant([...paths].some(file => file === path || file.startsWith(`${path.replace(/\/$/, "")}/`)), 400, "MISSING_SOURCE", `include no coincide con archivos: ${path}`);
  for (const rule of contributes.files) {
    exists(rule.source, "files.source");
    const permission = requiredTargetPermission(rule.target);
    if (permission) requirePermission(permission, `El destino ${rule.target}`);
    if (rule.executable) requirePermission("process.execute", "Un archivo ejecutable");
  }
  for (const tool of contributes.tools) {
    requirePermission("process.execute", `La herramienta ${tool.name}`);
    if (tool.envKeys.length) requirePermission("env.read", `La herramienta ${tool.name} con variables de entorno`);
    for (const reference of packageFileReferences([tool.command, ...tool.args])) exists(reference, `tools.${tool.name}`);
  }
  for (const server of contributes.mcpServers) {
    requirePermission("mcp.connect", `El servidor MCP ${server.name}`);
    for (const reference of packageFileReferences([server.command, ...server.args])) exists(reference, `mcpServers.${server.name}`);
  }
  for (const agent of contributes.agents) {
    for (const skill of agent.skills) invariant(Boolean(spec.dependencies[skill]), 400, "AGENT_DEPENDENCY", `La skill ${skill} debe declararse como dependencia`);
    invariant(!agent.capabilities.includes("modai_remember") || agent.memory.write, 400, "MEMORY_POLICY", `El agente ${agent.name} usa modai_remember pero memory.write es false`);
    // A capability that is not a built-in names an MCP server: declared here or contributed by a dependency
    // (dependencies are only known at resolution time, so the exact check happens when the agent is composed).
    for (const capability of agent.capabilities) {
      invariant(isBuiltinTool(capability) || contributes.mcpServers.some(server => server.name === capability) || Object.keys(spec.dependencies).length > 0, 400, "AGENT_CAPABILITY", `La capacidad ${capability} no es una herramienta de MODAI ni un servidor MCP: decláralo en contributes.mcpServers o depende del paquete que lo aporta`);
    }
  }
  if (spec.adapter) {
    const targets = spec.adapter.targets;
    const paths = [targets.skills?.path, targets.rules?.mode === "block" ? targets.rules.file : targets.rules?.path, targets.index?.file, targets.mcp?.file].filter((value): value is string => Boolean(value));
    for (const template of paths) {
      // Validate with representative placeholder values; real values are sanitised at install time.
      const sample = template.replace(/\{[a-z]+\}/g, "sample");
      if (adapterTargetPermission(sample)) requirePermission("project.instructions", `El adaptador que escribe ${template}`);
    }
  }
  if (manifest.kind === "Profile") {
    invariant(contributes.tools.length === 0 && contributes.mcpServers.length === 0, 400, "INVALID_PROFILE", "Un Profile compone paquetes; las herramientas viven en paquetes propios");
  }
  return manifest;
}

export function assertValid(raw: PackageManifest, files: ArtifactFile[]): PackageManifestV1 {
  try { return validatePackage(raw, files); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError(400, "INVALID_PACKAGE", (error as Error).message); }
}
