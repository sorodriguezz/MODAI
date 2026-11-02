import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { Command } from "commander";
import semver from "semver";
import YAML from "yaml";
import { ApiClient } from "@modai/sdk";
import { API_VERSION, type ProjectFile } from "@modai/contracts/spec-v1";
import {
  BUILTIN_ADAPTERS, INSTALL_PERMISSIONS, availableAdapters, createProjectFile, inspectWorkspace, isLegacyProject, isV1Project, loadContextIndex, loadGrants,
  loadPackageSource, loadV1Project, normalizeManifest, readKnowledgeChunk, runTool, saveGrants, saveProjectFile, searchKnowledge, suggestProviders,
} from "@modai/core";
import { loadClientConfig } from "../cli/config.js";
import { commaList } from "../cli/agent-commands.js";
import { confirm, defaultLocalRegistry, memoryProvider, projectRegistry, registrySource, runSync, summarize, tokenFor } from "./runtime.js";

type Print = (value: unknown) => void;

export function parseSpec(spec: string, root: string): { name: string; value: string } {
  if (spec.startsWith("file:") || spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || /^[A-Za-z]:[\\/]/.test(spec)) {
    const directory = resolve(root, spec.replace(/^file:/, ""));
    const input = loadPackageSource(directory);
    const name = normalizeManifest(input.manifest).metadata.name;
    return { name, value: `file:${relative(root, directory).replaceAll("\\", "/") || "."}` };
  }
  const separator = spec.lastIndexOf("@");
  if (!spec.startsWith("@") || !spec.includes("/")) throw new Error(`Paquete inválido: ${spec}. Usa @scope/nombre[@rango] o una ruta file:`);
  if (separator > spec.indexOf("/")) return { name: spec.slice(0, separator), value: spec.slice(separator + 1) || "*" };
  return { name: spec, value: "*" };
}

export async function initV1(root: string, options: { name?: string; registry?: string[]; adapter?: string[]; allow?: string[]; profile?: string; memory?: string; project?: string; server?: string }, print: Print): Promise<void> {
  if (isV1Project(root)) throw new Error("El proyecto ya está inicializado (modai.yaml existe).");
  if (isLegacyProject(root)) throw new Error("Este proyecto usa el formato 0.5 (.modai/manifest.yaml). Conviértelo con 'modai migrate'.");
  const config = loadClientConfig();
  const server = (options.server ?? config?.server)?.replace(/\/+$/, "");
  const registries = options.registry?.length
    ? options.registry.map((value, index) => registrySource(index ? `registry-${index + 1}` : "default", value, root))
    : server ? [{ name: "central", url: server }] : [{ name: "local", path: defaultLocalRegistry() }];
  const context: ProjectFile["context"] = { memory: (options.memory as "local") ?? (options.project ? "remote" : "local") };
  if (options.project) {
    if (!server) throw new Error("--project requiere un servidor conectado (modai connect <url>) o --server");
    const api = new ApiClient(server, tokenFor(server));
    if (!(await api.projects()).some(project => project.id === options.project)) throw new Error("Proyecto no autorizado para esta clave");
    Object.assign(context, { server, projectId: options.project });
  }
  const file = createProjectFile(options.name ?? basename(root), { registries, context, ...(options.adapter?.length ? { adapters: options.adapter } : {}) });
  saveProjectFile(root, file);
  try {
    const { report } = await runSync(root, options.profile ? draft => { const spec = parseSpec(options.profile!, root); draft.dependencies[spec.name] = spec.value; } : undefined, { allow: options.allow });
    print(`Proyecto MODAI inicializado en ${root}\nRegistries: ${registries.map(item => item.url ?? item.path).join(", ")}\nAdaptadores: ${file.adapters.join(", ")}\n${summarize(report)}\nSiguiente paso: modai add @scope/paquete`);
  } catch (error) {
    print(`modai.yaml creado, pero la primera sincronización falló: ${(error as Error).message}`);
    throw error;
  }
}

export async function addV1(root: string, specs: string[], options: { allow?: string[]; force?: boolean }, print: Print): Promise<void> {
  const parsed = specs.map(spec => parseSpec(spec, root));
  const { report, project } = await runSync(root, file => { for (const item of parsed) file.dependencies[item.name] = item.value; }, { allow: options.allow, force: options.force, update: parsed.map(item => item.name) });
  // Like npm: an unconstrained request is recorded as a caret range of the resolved version.
  const pinned = parsed.filter(item => item.value === "*" && project.lock.packages[item.name]);
  if (pinned.length) {
    const file = loadV1Project(root).file;
    for (const item of pinned) file.dependencies[item.name] = `^${project.lock.packages[item.name].version}`;
    saveProjectFile(root, file);
  }
  print(`Añadido ${parsed.map(item => item.name).join(", ")}.\n${summarize(report)}`);
  const executable = parsed.filter(item => project.lock.packages[item.name]?.permissions.some(permission => !INSTALL_PERMISSIONS.includes(permission)));
  if (executable.length) print(`Contiene herramientas ejecutables no autorizadas todavía. Revisa y autoriza con: ${executable.map(item => `modai grant ${item.name}`).join("; ")}`);
}

export async function removeV1(root: string, name: string, print: Print): Promise<void> {
  const project = loadV1Project(root);
  if (!(name in project.file.dependencies)) throw new Error(`${name} no es una dependencia directa del proyecto.`);
  const { report } = await runSync(root, file => { delete file.dependencies[name]; for (const [capability, provider] of Object.entries(file.providers)) if (provider === name) delete file.providers[capability]; });
  const grants = loadGrants(root);
  for (const grantName of Object.keys(grants.packages)) if (!report.lock.packages[grantName]) delete grants.packages[grantName];
  saveGrants(root, grants);
  print(`Retirado ${name}.\n${summarize(report)}`);
}

export async function syncV1(root: string, options: { allow?: string[]; frozen?: boolean; force?: boolean }, print: Print): Promise<void> {
  const { report } = await runSync(root, undefined, options);
  print(`Sincronizado.\n${summarize(report)}`);
}

export async function updateV1(root: string, names: string[], print: Print): Promise<void> {
  const before = loadV1Project(root).lock.packages;
  const { report } = await runSync(root, undefined, { update: names.length ? names : true });
  const changed = Object.entries(report.lock.packages).filter(([name, item]) => before[name]?.version !== item.version).map(([name, item]) => `${name}: ${before[name]?.version ?? "nuevo"} -> ${item.version}`);
  print(`${changed.length ? `Actualizados:\n${changed.join("\n")}` : "Todo está en la última versión permitida por modai.yaml."}\n${summarize(report)}`);
}

export async function outdatedV1(root: string, print: Print): Promise<void> {
  const project = loadV1Project(root);
  const registry = projectRegistry(project);
  const rows = [];
  for (const [name, locked] of Object.entries(project.lock.packages)) {
    if (locked.source.startsWith("file:")) { rows.push({ name, current: locked.version, latest: locked.version, source: locked.source, outdated: false }); continue; }
    const versions = (await registry.versions(name)).filter(item => item.status !== "yanked").map(item => item.version).sort(semver.rcompare);
    const latest = versions[0] ?? locked.version;
    rows.push({ name, current: locked.version, latest, wanted: project.file.dependencies[name] ?? "(transitiva)", outdated: semver.lt(locked.version, latest) });
  }
  print(rows);
}

export function statusV1(root: string, print: Print): void {
  const project = loadV1Project(root);
  const installed = inspectWorkspace(project);
  print({
    project: project.file.name, format: API_VERSION,
    registries: project.file.registries.map(item => item.url ?? item.path), adapters: project.file.adapters, memory: project.file.context.memory,
    dependencies: project.file.dependencies,
    installed: installed.map(item => ({ name: item.name, version: item.version, kind: item.kind, category: item.category, verified: item.verified,
      provides: item.manifest.spec.provides.map(capability => `${capability.capability}@${capability.version}`),
      contributes: Object.fromEntries(Object.entries(item.manifest.spec.contributes).filter(([, value]) => value.length).map(([key, value]) => [key, value.length])),
      executable: item.authorization.missing.length || item.authorization.allowed ? (item.authorization.allowed ? "autorizado" : "requiere modai grant") : "no" })),
    capabilities: project.lock.capabilities,
  });
}

export function capabilitiesV1(root: string, print: Print): void {
  const project = loadV1Project(root);
  const installed = inspectWorkspace(project);
  print({
    provided: project.lock.capabilities,
    required: Object.fromEntries(Object.entries(project.lock.packages).filter(([, item]) => Object.keys(item.requires).length).map(([name, item]) => [name, item.requires])),
    tools: installed.flatMap(item => item.manifest.spec.contributes.tools.map(tool => ({ tool: tool.name, package: item.name, implements: tool.implements, authorized: item.authorization.allowed && item.verified, ...(item.authorization.allowed ? {} : { reason: item.authorization.reason }) }))),
    mcpServers: installed.flatMap(item => item.manifest.spec.contributes.mcpServers.map(server => ({ server: server.name, package: item.name, authorized: item.authorization.allowed && item.verified }))),
    skills: installed.flatMap(item => item.manifest.spec.contributes.skills.map(skill => ({ skill: skill.name, package: item.name }))),
  });
}

export async function searchV1(root: string, query: string, options: { package?: string[]; limit?: string }, print: Print): Promise<void> {
  print(searchKnowledge(loadContextIndex(loadV1Project(root).root), query, { packages: options.package, limit: options.limit ? Number(options.limit) : undefined }));
}

export async function memoryV1(root: string, action: "remember" | "recall" | "list" | "forget", value: string | undefined, options: { kind?: string; scope?: string }, print: Print): Promise<void> {
  const provider = memoryProvider(loadV1Project(root));
  if (!provider) throw new Error("La memoria está desactivada (context.memory: off)");
  if (action === "remember") print(await provider.remember({ content: value!, kind: options.kind, scope: options.scope === "user" ? "user" : "project" }));
  else if (action === "recall") print(await provider.recall(value!));
  else if (action === "list") print(await provider.list());
  else { await provider.forget(value!); print(`Memoria eliminada: ${value}`); }
}

export async function publishV1(directory: string, registry: import("@modai/core").Registry, input: import("@modai/contracts/types").PublishPackageInput, print: Print): Promise<void> {
  if (!registry.publish) throw new Error(`${registry.id} no admite publicación`);
  const result = await registry.publish(input);
  print(`Publicado ${result.name}@${result.version} en ${registry.id} (${result.integrity}) desde ${directory}`);
}

export function scaffoldV1(directory: string, options: { name: string; kind?: string; category?: string; withTool?: boolean }): string {
  const root = resolve(directory);
  if (existsSync(root)) throw new Error(`La carpeta ya existe: ${root}`);
  const kind = (options.kind ?? "package").replace(/^./, char => char.toUpperCase());
  if (!["Package", "Profile", "Adapter"].includes(kind)) throw new Error("--kind debe ser package, profile o adapter");
  const short = options.name.split("/").pop()!.replace(/[^a-z0-9-]/g, "-");
  const tool = short.replaceAll("-", "_").slice(0, 40);
  const spec: Record<string, unknown> = { category: options.category ?? "general", dependencies: {}, provides: [], requires: [], permissions: [] };
  const files: Record<string, string> = {};
  if (kind === "Package") {
    spec.provides = [`${options.category ?? "general"}.${short}@1.0.0`];
    spec.entrypoints = { skills: "skills", knowledge: "knowledge", rules: "rules" };
    files[`skills/${short}/SKILL.md`] = `---\nname: ${short}\ndescription: Explica qué logra esta skill, cuándo debe activarse y qué solicitudes quedan fuera de su alcance.\n---\n\n# ${short}\n\nDefine el resultado esperado, las decisiones no obvias y los límites reales.\n\n## Flujo\n\n1. Inspecciona el contexto relevante.\n2. Ejecuta el trabajo manteniendo el alcance solicitado.\n3. Verifica el resultado con evidencia observable.\n`;
    files["knowledge/README.md"] = `# ${short}\n\nConocimiento que el agente recupera bajo demanda con modai_search_knowledge.\n`;
    files["rules/README.md"] = "Regla breve que el adaptador incorpora a las instrucciones del agente.\n";
    if (options.withTool) {
      spec.permissions = ["process.execute", "filesystem.read"];
      spec.include = ["tools"];
      spec.contributes = { tools: [{ name: tool, description: `Describe qué hace ${tool} y qué devuelve.`, implements: (spec.provides as string[])[0].split("@")[0], command: "node", args: ["${packageDir}/tools/run.mjs"],
        inputSchema: { type: "object", properties: { target: { type: "string", maxLength: 500 } }, additionalProperties: false } }] };
      files["tools/run.mjs"] = `// Recibe JSON por stdin y responde JSON por stdout. Se ejecuta sin shell, con el proyecto como cwd.\nlet raw = "";\nfor await (const chunk of process.stdin) raw += chunk;\nconst input = JSON.parse(raw || "{}");\nconsole.log(JSON.stringify({ ok: true, received: input, project: process.env.MODAI_PROJECT_DIR }));\n`;
    }
  } else if (kind === "Profile") {
    spec.dependencies = { "@scope/paquete": "^1.0.0" };
  } else {
    spec.permissions = ["project.instructions"];
    spec.adapter = { id: short, description: `Materializa capacidades MODAI para ${short}.`, targets: { skills: { path: `.${short}/skills/{skill}` }, rules: { mode: "file", path: `.${short}/rules/{package}-{rule}.md` }, mcp: { file: `.${short}/mcp.json`, pointer: "mcpServers.modai" } } };
  }
  const manifest = { apiVersion: API_VERSION, kind, metadata: { name: options.name, version: "0.1.0", description: `Describe con precisión qué aporta ${options.name} y cuándo usarlo.` }, spec };
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "modai.package.yaml"), YAML.stringify(manifest, { lineWidth: 0 }), { flag: "wx" });
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), content, { flag: "wx" }); }
  return root;
}

/** Converts a 0.5 project (.modai/manifest.yaml + lock.yaml) into modai.yaml + modai.lock without losing installed files. */
export async function migrateV1(root: string, options: { allow?: string[]; force?: boolean }, print: Print): Promise<void> {
  if (isV1Project(root)) throw new Error("El proyecto ya usa modai.yaml");
  const legacyPath = join(root, ".modai", "manifest.yaml");
  if (!existsSync(legacyPath)) throw new Error("No hay un proyecto 0.5 que migrar (.modai/manifest.yaml)");
  const legacy = YAML.parse(readFileSync(legacyPath, "utf8")) as { projectId: string; server?: string; packages: Record<string, string>; overrides?: Record<string, string>; grants?: string[] };
  const server = (legacy.server ?? loadClientConfig()?.server)?.replace(/\/+$/, "");
  const file = createProjectFile(basename(root), {
    registries: server ? [{ name: "central", url: server }] : [{ name: "local", path: defaultLocalRegistry() }],
    dependencies: legacy.packages, overrides: legacy.overrides ?? {},
    context: server ? { memory: "remote", server, projectId: legacy.projectId } : { memory: "local" },
  });
  saveProjectFile(root, file);
  try {
    const { report } = await runSync(root, undefined, { allow: [...(legacy.grants ?? []), ...(options.allow ?? [])], force: options.force });
    const archive = join(root, ".modai", "legacy-0.5");
    mkdirSync(archive, { recursive: true });
    for (const name of ["manifest.yaml", "lock.yaml", "config.yaml"]) if (existsSync(join(root, ".modai", name))) renameSync(join(root, ".modai", name), join(archive, name));
    print(`Proyecto migrado a ${API_VERSION}. Archivos 0.5 archivados en .modai/legacy-0.5/.\n${summarize(report)}`);
  } catch (error) {
    renameSync(join(root, "modai.yaml"), join(root, ".modai", "modai.yaml.failed"));
    throw error;
  }
}

function v1Project(): string {
  const root = process.cwd();
  if (!isV1Project(root)) throw new Error(isLegacyProject(root) ? "Este comando requiere un proyecto v1. Ejecuta 'modai migrate'." : "No es un proyecto MODAI: ejecuta 'modai init'.");
  return root;
}

/** Commands that only exist for v1 projects. */
export function registerV1Commands(program: Command, print: Print): void {
  program.command("grant").description("Autoriza en este equipo las herramientas y servidores MCP de un paquete instalado").argument("<package>")
    .option("--yes", "No pide confirmación")
    .action(async (name: string, options: { yes?: boolean }) => {
      const root = v1Project(), project = loadV1Project(root);
      const locked = project.lock.packages[name];
      if (!locked) throw new Error(`${name} no está instalado`);
      const item = inspectWorkspace(project).find(entry => entry.name === name)!;
      if (!item.verified) throw new Error(`La copia local de ${name} no supera la verificación de integridad; ejecuta modai sync`);
      const { tools, mcpServers } = item.manifest.spec.contributes;
      print(`${name}@${locked.version} (${locked.integrity})\nPermisos declarados: ${locked.permissions.join(", ") || "ninguno"}\nHerramientas: ${tools.map(tool => `${tool.name} → ${tool.command} ${tool.args.join(" ")}`).join("; ") || "ninguna"}\nServidores MCP: ${mcpServers.map(server => `${server.name} → ${server.command} ${server.args.join(" ")}`).join("; ") || "ninguno"}\nMODAI no es un sandbox: un proceso autorizado se ejecuta con tus permisos de usuario.`);
      if (!(await confirm(`¿Autorizar ${name} en este equipo?`, options.yes))) { print("Sin cambios."); return; }
      const grants = loadGrants(root);
      grants.packages[name] = { integrity: locked.integrity, permissions: locked.permissions, grantedAt: new Date().toISOString() };
      saveGrants(root, grants);
      print(`Autorizado ${name}. Sus herramientas quedan disponibles en el gateway MCP (modai-mcp) y en modai tools run.`);
    });
  program.command("revoke").description("Retira la autorización local de un paquete").argument("<package>").action((name: string) => {
    const root = v1Project(), grants = loadGrants(root);
    delete grants.packages[name];
    saveGrants(root, grants);
    print(`Autorización retirada: ${name}`);
  });
  program.command("permissions").description("Muestra permisos concedidos en este equipo para el proyecto").action(() => {
    const root = v1Project(), project = loadV1Project(root), grants = loadGrants(root);
    print({ install: grants.install, packages: Object.fromEntries(inspectWorkspace(project).map(item => [item.name, { declared: item.manifest.spec.permissions, granted: grants.packages[item.name]?.permissions ?? [], allowed: item.authorization.allowed, reason: item.authorization.reason }])) });
  });

  const tools = program.command("tools").description("Herramientas ejecutables aportadas por paquetes");
  tools.command("list").action(() => capabilitiesV1(v1Project(), value => print((value as { tools: unknown }).tools)));
  tools.command("run").argument("<tool>").option("--input <json>", "Entrada JSON", "{}").action(async (name: string, options: { input: string }) => {
    const root = v1Project(), project = loadV1Project(root), grants = loadGrants(root);
    const owner = inspectWorkspace(project).find(item => item.manifest.spec.contributes.tools.some(tool => tool.name === name));
    if (!owner) throw new Error(`Herramienta no instalada: ${name}`);
    if (!owner.verified) throw new Error(`${owner.name} no supera la verificación de integridad; ejecuta modai sync`);
    if (!owner.authorization.allowed) throw new Error(`${owner.name}: ${owner.authorization.reason}`);
    print(await runTool(owner.manifest.spec.contributes.tools.find(tool => tool.name === name)!, JSON.parse(options.input), { packageDir: owner.packageDir, projectDir: root, grant: grants.packages[owner.name] }));
  });

  const context = program.command("context").description("Context Gateway: conocimiento recuperado bajo demanda con procedencia");
  context.command("search").argument("<query>").option("--package <name>", "Limita a paquetes", commaList).option("--limit <n>").action((query: string, options) => searchV1(v1Project(), query, options, print));
  context.command("show").argument("<id>").action((id: string) => {
    const chunk = readKnowledgeChunk(loadContextIndex(v1Project()), id);
    if (!chunk) throw new Error(`Fragmento no encontrado: ${id}`);
    print(chunk);
  });

  const adapter = program.command("adapter").description("Adaptadores que conectan las capacidades con cada agente");
  adapter.command("list").action(() => {
    const root = process.cwd();
    const installed = isV1Project(root) ? inspectWorkspace(loadV1Project(root)).map(item => ({ name: item.name, manifest: item.manifest })) : [];
    const active = isV1Project(root) ? loadV1Project(root).file.adapters : [];
    print((installed.length ? availableAdapters(installed) : BUILTIN_ADAPTERS.map(definition => ({ definition, source: "builtin" })))
      .map(item => ({ id: item.definition.id, source: item.source, active: active.includes(item.definition.id), targets: Object.keys(item.definition.targets), description: item.definition.description })));
  });
  adapter.command("add").argument("<id>").option("--allow <permissions>", "Permisos de instalación", commaList).action(async (id: string, options: { allow?: string[] }) => {
    const { report } = await runSync(v1Project(), file => { if (!file.adapters.includes(id)) file.adapters.push(id); }, { allow: options.allow });
    print(`Adaptador ${id} activo.\n${summarize(report)}`);
  });
  adapter.command("remove").argument("<id>").action(async (id: string) => {
    const { report } = await runSync(v1Project(), file => { file.adapters = file.adapters.filter(item => item !== id); });
    print(`Adaptador ${id} desactivado.\n${summarize(report)}`);
  });

  program.command("providers").description("Busca en los registries paquetes que proporcionan una capacidad").argument("<capability>").action(async (capability: string) => {
    print(await suggestProviders(projectRegistry(loadV1Project(v1Project())), capability));
  });
  program.command("provider").description("Fija el proveedor de una capacidad cuando hay varios instalados").argument("<capability>").argument("<package>").action(async (capability: string, name: string) => {
    const { report } = await runSync(v1Project(), file => { file.providers[capability] = name; });
    print(`${capability} → ${name}\n${summarize(report)}`);
  });
  program.command("migrate").description("Convierte un proyecto 0.5 al formato modai.yaml / modai.lock").option("--allow <permissions>", "Permisos de instalación", commaList).option("--force", "Sobrescribe conflictos").action((options) => migrateV1(process.cwd(), options, print));
}

export { tokenFor };
