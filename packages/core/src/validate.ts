import semver from "semver";
import { AppError, invariant } from "@modai/contracts/errors";
import { assertSafeRelativePath, requiredTargetPermission, sha256 } from "@modai/contracts/security";
import { isBuiltinTool } from "@modai/contracts/agent-tools";
import type { ArtifactFile, PackageManifest } from "@modai/contracts/types";
import type { PackageManifestV1 } from "@modai/contracts/spec-v1";
import { assertFeatureRules } from "./features.js";
import { normalizeManifest } from "./normalize.js";
import { packageFeatureRules } from "./package-features.js";
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
  type FeatureContributions = Omit<typeof contributes, "agents">;
  const all = [contributes, ...Object.values(spec.features).map(feature => feature.contributes)] as FeatureContributions[];
  // Names are unique across the package and all of its features, so any combination of features installs cleanly.
  const unique = (kind: string, names: string[]) => {
    const seen = new Set<string>();
    for (const name of names) { invariant(!seen.has(name), 400, "DUPLICATE_CONTRIBUTION", `${kind} duplicado: ${name}`); seen.add(name); }
  };
  unique("Skill", all.flatMap(item => item.skills.map(entry => entry.name)));
  unique("Regla", all.flatMap(item => item.rules.map(entry => entry.name)));
  unique("Herramienta", all.flatMap(item => item.tools.map(entry => entry.name)));
  unique("Servidor MCP", all.flatMap(item => item.mcpServers.map(entry => entry.name)));
  unique("Componente", all.flatMap(item => item.components.map(entry => entry.name)));
  const checkContributions = (contributes: FeatureContributions, where: string) => {
    const label = (text: string) => (where ? `${text} (feature ${where})` : text);
    for (const component of contributes.components) {
      assertSafeRelativePath(component.path, "components.path");
      const entries = componentFiles(component, manifest.metadata.name, paths);
      invariant(entries.length > 0, 400, "COMPONENT_EMPTY", label(`El componente ${component.name} no tiene archivos en ${component.path}`));
      for (const entry of entries) componentTargetPermission(entry.target);
      requirePermission("project.source", label(`El componente ${component.name}`));
    }
    for (const skill of contributes.skills) {
      const entries = skillFiles(skill, paths);
      invariant(entries.some(entry => entry.relative === "SKILL.md"), 400, "SKILL_ENTRYPOINT_MISSING", label(`La skill ${skill.name} necesita ${skill.path}/SKILL.md`));
      for (const entry of entries) exists(entry.source, "skills.path");
    }
    for (const rule of contributes.rules) exists(rule.path, "rules.path");
    for (const item of contributes.knowledge) exists(item.path, "knowledge.path");
    for (const rule of contributes.files) {
      exists(rule.source, "files.source");
      const permission = requiredTargetPermission(rule.target);
      if (permission) requirePermission(permission, label(`El destino ${rule.target}`));
      if (rule.executable) requirePermission("process.execute", label("Un archivo ejecutable"));
    }
    for (const tool of contributes.tools) {
      requirePermission("process.execute", label(`La herramienta ${tool.name}`));
      if (tool.envKeys.length) requirePermission("env.read", label(`La herramienta ${tool.name} con variables de entorno`));
      for (const reference of packageFileReferences([tool.command, ...tool.args])) exists(reference, `tools.${tool.name}`);
    }
    for (const server of contributes.mcpServers) {
      requirePermission("mcp.connect", label(`El servidor MCP ${server.name}`));
      for (const reference of packageFileReferences([server.command, ...server.args])) exists(reference, `mcpServers.${server.name}`);
    }
  };
  checkContributions(contributes, "");
  for (const path of spec.include) invariant([...paths].some(file => file === path || file.startsWith(`${path.replace(/\/$/, "")}/`)), 400, "MISSING_SOURCE", `include no coincide con archivos: ${path}`);
  validateFeatures(manifest, paths, checkContributions);
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
    invariant(all.every(item => item.tools.length === 0 && item.mcpServers.length === 0), 400, "INVALID_PROFILE", "Un Profile compone paquetes; las herramientas viven en paquetes propios");
  }
  return manifest;
}

/** Directories a contribution reads files from (components and skills), without a trailing slash; "" is the root. */
function contributionDirectories(contributes: { components: Array<{ path: string }>; skills: Array<{ path: string }> }): string[] {
  return [...contributes.components, ...contributes.skills].map(item => (item.path === "." ? "" : item.path.replace(/\/$/, "")));
}
const inside = (path: string, directory: string) => directory === "" || path === directory || path.startsWith(`${directory}/`);
/** Every path a feature reads files from: its contribution folders and files, and its overlay folders. */
const ownPaths = (feature: PackageManifestV1["spec"]["features"][string]) => [
  ...contributionDirectories(feature.contributes),
  ...feature.overlays.map(overlay => overlay.path.replace(/\/$/, "")),
  ...feature.contributes.rules.map(rule => rule.path), ...feature.contributes.knowledge.map(item => item.path), ...feature.contributes.files.map(rule => rule.source),
];

/**
 * Features: consistent rules, valid dependencies, contributions checked like the package's own, overlays that point at
 * a component they can reach, and feature files kept out of the base's folders (otherwise the base would install them).
 */
function validateFeatures(manifest: PackageManifestV1, paths: Set<string>, checkContributions: (contributes: PackageManifestV1["spec"]["features"][string]["contributes"], where: string) => void): void {
  const { spec } = manifest;
  const entries = Object.entries(spec.features);
  if (!entries.length) return;
  assertFeatureRules(packageFeatureRules(manifest), manifest.metadata.name);
  const baseDirectories = contributionDirectories(spec.contributes);
  const reachable = (name: string, seen = new Set<string>()): string[] => {
    if (seen.has(name)) return [];
    seen.add(name);
    return [name, ...spec.features[name]!.requires.flatMap(required => reachable(required, seen))];
  };
  for (const [name, feature] of entries) {
    for (const [dependency, range] of Object.entries(feature.dependencies)) {
      invariant(Boolean(semver.validRange(range)), 400, "INVALID_DEPENDENCY", `Dependencia inválida en la feature ${name}: ${dependency}@${range}`);
      invariant(dependency !== manifest.metadata.name, 400, "INVALID_DEPENDENCY", `La feature ${name} no puede depender del propio paquete`);
      invariant(!(dependency in spec.dependencies), 400, "INVALID_DEPENDENCY", `${dependency} ya es dependencia del paquete; quítala de la feature ${name}`);
    }
    invariant(Object.values(feature.contributes).some(list => list.length) || Object.keys(feature.dependencies).length > 0 || feature.overlays.length > 0 || feature.requires.length > 0, 400, "INVALID_FEATURE", `La feature ${name} no aporta nada: añade contributes, dependencies, overlays o requires`);
    checkContributions(feature.contributes, name);
    const own = ownPaths(feature);
    for (const directory of contributionDirectories(feature.contributes)) invariant(directory !== "", 400, "FEATURE_PATH_IN_BASE", `La feature ${name} usa la raíz del paquete como carpeta: instalaría todos los archivos. Usa una carpeta propia (por ejemplo features/${name}).`);
    for (const path of own) {
      const base = baseDirectories.find(directory => inside(path, directory));
      invariant(base === undefined, 400, "FEATURE_PATH_IN_BASE", `La feature ${name} usa ${path}, que está dentro de ${base || "la raíz"}, una carpeta del paquete base: el base la instalaría siempre. Mueve los archivos de la feature a su propia carpeta (por ejemplo features/${name}).`);
    }
    // Folders of a feature are its own: another feature's files inside them, or the base's, would ride along.
    const ownDirectories = [...contributionDirectories(feature.contributes), ...feature.overlays.map(overlay => overlay.path.replace(/\/$/, ""))];
    for (const directory of ownDirectories) {
      for (const base of baseDirectories) invariant(!inside(base, directory), 400, "FEATURE_PATH_IN_BASE", `La carpeta ${base || "raíz"} del paquete base está dentro de ${directory}, de la feature ${name}`);
      for (const [otherName, other] of entries) {
        if (otherName === name) continue;
        const clash = ownPaths(other).find(path => inside(path, directory));
        invariant(clash === undefined, 400, "FEATURE_PATH_OVERLAP", `La feature ${otherName} usa ${clash}, dentro de ${directory}, una carpeta de la feature ${name}: se instalaría con ella. Dale a cada feature su propia carpeta.`);
      }
    }
    const components = reachable(name).flatMap(feature => spec.features[feature]!.contributes.components).concat(spec.contributes.components);
    for (const overlay of feature.overlays) {
      assertSafeRelativePath(overlay.path, "overlays.path");
      invariant(components.some(component => component.name === overlay.component), 400, "INVALID_FEATURE", `La feature ${name} modifica el componente "${overlay.component}", que no existe en el paquete ni en las features que requiere`);
      const from = `${overlay.path.replace(/\/$/, "")}/`;
      invariant([...paths].some(path => path.startsWith(from)), 400, "MISSING_SOURCE", `La feature ${name}: la carpeta ${overlay.path} no tiene archivos`);
      // Overlay files land where the component's files land: same destination rules, checked now and not at install.
      const component = components.find(item => item.name === overlay.component)!;
      const directory = expandTemplate(component.target, { component: component.name, package: manifest.metadata.name }).replace(/\/$/, "");
      for (const path of paths) if (path.startsWith(from)) componentTargetPermission(`${directory}/${path.slice(from.length)}`);
    }
  }
}

export function assertValid(raw: PackageManifest, files: ArtifactFile[]): PackageManifestV1 {
  try { return validatePackage(raw, files); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError(400, "INVALID_PACKAGE", (error as Error).message); }
}
