#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Command } from "commander";
import semver from "semver";
import { analyzePackageQuality } from "@modai/contracts/package-quality";
import { PACKAGE_TYPES, type PackageType } from "@modai/contracts/types";
import { ApiClient } from "@modai/sdk";
import {
  clientConfigPath,
  createManifest,
  loadClientConfig,
  loadProject,
  projectPaths,
  saveClientConfig,
  writeYaml,
  type ProjectManifest,
} from "./config.js";
import { synchronize } from "./installer.js";
import { loadPackageSource } from "./package-source.js";
import { auditHarness, createHarness } from "./harness-tools.js";
import { generateSigningKey, scaffoldPackage, signPackage } from "./package-authoring.js";
import { permissionSchema, signaturePolicySchema, publishSchema, parseInput } from "@modai/contracts/schemas";
import { publicKeyFingerprint } from "@modai/contracts/security";
import { readAccessToken } from "./credentials.js";
import { effectiveConnection } from "./connection.js";
import { registerAgentCommands, commaList } from "./agent-commands.js";
import { registerClientCommands } from "./client-commands.js";
import { isV1Project, loadV1Project, normalizeManifest as normalizeManifestSafe, validatePackage } from "@modai/core";
import {
  addV1, initV1, memoryV1, outdatedV1, publishV1, registerV1Commands, removeV1, scaffoldV1, searchV1, statusV1, syncV1, updateV1,
} from "../v1/commands.js";
import { registryFromArgument, registrySource, runSync, summarize, defaultLocalRegistry } from "../v1/runtime.js";
import { CompositeRegistry } from "@modai/core/registry";
import { createRegistries } from "@modai/core/workspace";
import { tokenFor } from "../v1/runtime.js";
import { registerListCommands } from "../v1/list.js";

const v1 = () => isV1Project(process.cwd());

function splitPackageSpec(spec: string): { name: string; range: string } {
  const separator = spec.lastIndexOf("@");
  if (!spec.startsWith("@") || !spec.includes("/")) throw new Error(`Paquete inválido: ${spec}. Usa @scope/nombre[@rango].`);
  if (separator > spec.indexOf("/")) return { name: spec.slice(0, separator), range: spec.slice(separator + 1) || "*" };
  return { name: spec, range: "*" };
}

function projectApi(manifest: ProjectManifest): ApiClient {
  const connection = effectiveConnection(manifest.server);
  return new ApiClient(connection.server, connection.token);
}

function print(value: unknown): void {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

const program = new Command();
program.name("modai").description("MODAI: gestor de paquetes y capacidades extensibles para agentes de IA").version("0.7.0");

program
  .command("connect")
  .description("Conecta la CLI a un servidor ModularAI")
  .argument("<url>", "URL del servidor")
  .option("--token <token>", "Token Bearer (prefiere la entrada oculta o --token-stdin)")
  .option("--token-stdin", "Lee la API key por stdin para automatizaciones")
  .action(async (url: string, options: { token?: string; tokenStdin?: boolean }) => {
    const server = url.replace(/\/+$/, "");
    if (options.token && options.tokenStdin) throw new Error("Usa --token o --token-stdin, no ambos");
    const token = options.token ?? (options.tokenStdin ? await readAccessToken(true) : effectiveConnection(server).token ?? await readAccessToken());
    const api = new ApiClient(server, token);
    await api.assertCompatible();
    const health = await api.health();
    const identity = await api.session();
    const projects = await api.projects();
    saveClientConfig({ ...loadClientConfig(), server, token });
    print(`Conectado a ${server} (ModularAI ${health.version}) como ${identity.label} · ${identity.role}. Configuración: ${clientConfigPath}`);
    print(projects.length ? projects.map(project => `${project.name}: modai init --project '${project.id.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`).join("\n") : "No hay proyectos asignados. Pide acceso al administrador o crea uno con modai init si tu rol lo permite.");
  });

program.command("whoami").description("Muestra la identidad y los proyectos autorizados").action(async () => {
  const connection = effectiveConnection();
  const api = new ApiClient(connection.server, connection.token);
  print({ server: connection.server, ...await api.session(), projects: await api.projects() });
});

async function initLegacy(options: { profile?: string; server?: string; project?: string; name?: string; organization?: string; allow?: string[] }): Promise<void> {
    const paths = projectPaths();
    if (existsSync(paths.manifest)) throw new Error("El proyecto ya está inicializado.");
    const connection = effectiveConnection(options.server);
    const api = new ApiClient(connection.server, connection.token);
    await api.assertCompatible();
    const manifest = createManifest(connection.server);
    if (options.project) {
      const project = (await api.projects()).find(project => project.id === options.project);
      if (!project) throw new Error("Proyecto no autorizado para esta clave");
      manifest.projectId = project.id;
    } else {
      await api.createProject({ id: manifest.projectId, name: options.name ?? basename(paths.root), organizationId: options.organization });
    }
    manifest.grants = (options.allow ?? []).map(value => permissionSchema.parse(value));
    if (options.profile) {
      const profile = splitPackageSpec(options.profile);
      manifest.packages[profile.name] = profile.range;
    }
    const emptyLock = { schemaVersion: 1 as const, generatedAt: new Date(0).toISOString(), packages: [] };
    const result = await synchronize(api, paths.root, manifest, emptyLock, manifest.grants);
    writeYaml(paths.manifest, manifest);
    writeYaml(paths.lock, result.lock);
    writeYaml(paths.config, { schemaVersion: 1, server: connection.server, projectId: manifest.projectId });
    print(`Proyecto ${manifest.projectId} inicializado${options.profile ? ` con ${options.profile}` : ""}.`);
  }

program
  .command("init")
  .description("Inicializa MODAI en el proyecto actual (modai.yaml); no requiere servidor")
  .option("--name <name>", "Nombre del proyecto")
  .option("--registry <url|path>", "Registry de paquetes: URL de un servidor MODAI o carpeta local (repetible)", commaList)
  .option("--adapter <ids>", "Adaptadores activos, por ejemplo agent-skills,agents-md,claude-code,mcp", commaList)
  .option("--profile <package>", "Perfil o paquete inicial, por ejemplo @profiles/fullstack-quality")
  .option("--allow <permissions>", "Permisos de instalación concedidos en este equipo", commaList)
  .option("--memory <mode>", "Memoria: local, remote u off")
  .option("--project <id>", "Proyecto del servidor central cuya memoria se comparte (memoria remota)")
  .option("--server <url>", "Servidor MODAI específico para este proyecto")
  .option("--organization <id>", "Organización del proyecto nuevo (solo --legacy)")
  .option("--legacy", "Crea un proyecto con el formato 0.5 ligado al servidor (necesario para modai agent)")
  .action(async (options: { profile?: string; server?: string; project?: string; name?: string; organization?: string; allow?: string[]; registry?: string[]; adapter?: string[]; memory?: string; legacy?: boolean }) => {
    if (!options.legacy) return initV1(process.cwd(), options, print);
    await initLegacy(options);
  });

program
  .command("add")
  .description("Añade paquetes (y sus dependencias) al proyecto")
  .argument("<packages...>", "@scope/nombre[@rango] o file:../ruta")
  .option("--allow <permissions>", "Permisos de instalación concedidos en este equipo", commaList)
  .option("--force", "Sobrescribe archivos administrados que fueron modificados")
  .action(async (specs: string[], options: { allow?: string[]; force?: boolean }) => {
    if (v1()) return addV1(process.cwd(), specs, options, print);
    if (specs.length !== 1) throw new Error("Los proyectos 0.5 añaden un paquete por vez");
    const spec = specs[0];
    const project = loadProject();
    const item = splitPackageSpec(spec);
    const next = structuredClone(project.manifest);
    next.packages[item.name] = item.range;
    next.grants = [...new Set([...(next.grants ?? []), ...(options.allow ?? []).map(value => permissionSchema.parse(value))])];
    const result = await synchronize(projectApi(next), project.paths.root, next, project.lock, (options.allow ?? []).map(value => permissionSchema.parse(value)));
    writeYaml(project.paths.manifest, next);
    writeYaml(project.paths.lock, result.lock);
    print(`Instalado ${item.name}@${item.range}. ${result.lock.packages.length} paquete(s) resuelto(s).`);
  });

program
  .command("remove")
  .description("Retira una capacidad directa conservando archivos modificados")
  .argument("<package>", "@scope/nombre")
  .action(async (name: string) => {
    if (v1()) return removeV1(process.cwd(), name, print);
    const project = loadProject();
    if (!(name in project.manifest.packages)) throw new Error(`${name} no es una dependencia directa del proyecto.`);
    const next = structuredClone(project.manifest);
    delete next.packages[name];
    const result = await synchronize(projectApi(next), project.paths.root, next, project.lock);
    writeYaml(project.paths.manifest, next);
    writeYaml(project.paths.lock, result.lock);
    print(`Retirado ${name}.${result.preserved.length ? ` Conservados: ${result.preserved.join(", ")}` : ""}`);
  });

program
  .command("sync")
  .description("Reconstruye el entorno exacto desde modai.yaml y modai.lock")
  .option("--allow <permissions>", "Permisos de instalación aprobados en este equipo", commaList)
  .option("--frozen", "Falla si modai.lock no corresponde a modai.yaml (CI)")
  .option("--force", "Sobrescribe archivos administrados que fueron modificados")
  .action(async (options: { allow?: string[]; frozen?: boolean; force?: boolean }) => {
    if (v1()) return syncV1(process.cwd(), options, print);
    const project = loadProject();
    const result = await synchronize(projectApi(project.manifest), project.paths.root, project.manifest, project.lock, (options.allow ?? []).map(value => permissionSchema.parse(value)));
    writeYaml(project.paths.lock, result.lock);
    print(`Sincronizado: ${result.lock.packages.length} paquete(s).${result.preserved.length ? ` Conservados: ${result.preserved.join(", ")}` : ""}`);
  });

program
  .command("status")
  .description("Muestra el estado del proyecto")
  .action(() => {
    if (v1()) return statusV1(process.cwd(), print);
    const project = loadProject();
    print({
      projectId: project.manifest.projectId,
      server: project.manifest.server ?? loadClientConfig()?.server,
      requested: project.manifest.packages,
      overrides: project.manifest.overrides ?? {},
      installed: project.lock.packages.map(({ name, version, files }) => ({ name, version, files: files.length })),
    });
  });

const registryCommand = program.command("registry").description("Registries del proyecto y búsqueda de paquetes");
registryCommand.command("list").description("Registries configurados en modai.yaml").action(() => print(loadV1Project().file.registries));
registryCommand.command("add").argument("<name>").argument("<url-or-path>").description("Añade un registry (URL de servidor MODAI o carpeta local)").action(async (name: string, value: string) => {
  const { report } = await runSync(process.cwd(), file => { if (file.registries.some(item => item.name === name)) throw new Error(`Ya existe el registry ${name}`); file.registries.push(registrySource(name, value, process.cwd())); });
  print(`Registry ${name} añadido.\n${summarize(report)}`);
});
registryCommand.command("remove").argument("<name>").action(async (name: string) => {
  const { report } = await runSync(process.cwd(), file => { file.registries = file.registries.filter(item => item.name !== name); });
  print(`Registry ${name} retirado.\n${summarize(report)}`);
});
registryCommand
  .command("packages")
  .description("Lista paquetes disponibles")
  .option("--query <text>", "Filtro de texto")
  .option("--all", "Incluye versiones retiradas (servidor)")
  .option("--registry <url|path>", "Registry concreto")
  .action(async (options: { query?: string; all?: boolean; registry?: string }) => {
    if (options.registry || v1()) {
      const project = v1() ? loadV1Project() : undefined;
      const registry = options.registry ? registryFromArgument(options.registry, project) : new CompositeRegistry(createRegistries(project!.root, project!.file.registries, tokenFor));
      print((await registry.list(options.query)).map(item => { const m = (() => { try { return normalizeManifestSafe(item.manifest); } catch { return undefined; } })(); return { name: item.name, version: item.version, kind: m?.kind, category: m?.spec.category, provides: m?.spec.provides.map(c => `${c.capability}@${c.version}`), description: m?.metadata.description, registry: item.registry }; }));
      return;
    }
    const connection = effectiveConnection();
    const packages = await new ApiClient(connection.server, connection.token).listPackages(options.query, options.all);
    print(packages.map(({ name, version, type, status, description, quality, signerFingerprint }) => ({ name, version, type, status, quality: quality?.score, signedBy: signerFingerprint, description })));
  });

program
  .command("publish")
  .description("Publica un paquete inmutable en un registry (servidor MODAI o carpeta local)")
  .argument("[directory]", "Carpeta del paquete", ".")
  .option("--key <private-key>", "Firma el paquete con una clave privada Ed25519")
  .option("--registry <name|url|path>", "Registry destino; por defecto el servidor conectado")
  .action(async (directory: string, options: { key?: string; registry?: string }) => {
    let input = loadPackageSource(resolve(directory));
    validatePackage(input.manifest, input.files);
    if (options.key) input = signPackage(input, readFileSync(resolve(options.key), "utf8"));
    if (options.registry) return publishV1(resolve(directory), registryFromArgument(options.registry, v1() ? loadV1Project() : undefined), input, print);
    const connection = effectiveConnection();
    const published = await new ApiClient(connection.server, connection.token).publish(input);
    print(`Publicado ${published.name}@${published.version} (${published.artifactId}), calidad ${published.quality?.score ?? "legacy"}/100${published.signerFingerprint ? ", firmado" : ""}.`);
  });

program
  .command("search")
  .description("Busca conocimiento relevante (Context Gateway)")
  .argument("<query>", "Consulta")
  .option("--package <names>", "Limita a paquetes", commaList)
  .option("--limit <n>", "Máximo de resultados")
  .action(async (query: string, options: { package?: string[]; limit?: string }) => {
    if (v1()) return searchV1(process.cwd(), query, options, print);
    const project = loadProject();
    const packageNames = project.lock.packages.map((item) => item.name);
    print(await projectApi(project.manifest).searchKnowledge(query, packageNames));
  });

program
  .command("remember")
  .description("Guarda una memoria del proyecto")
  .argument("<content>", "Contenido")
  .option("--kind <kind>", "Tipo de memoria", "note")
  .option("--scope <scope>", "project, user (v1), organization o session (servidor)", "project")
  .option("--session <id>", "Identificador de sesión")
  .action(async (content: string, options: { kind: string; scope: string; session?: string }) => {
    if (v1()) return memoryV1(process.cwd(), "remember", content, options, print);
    const project = loadProject();
    const memory = await projectApi(project.manifest).remember({
      projectId: project.manifest.projectId,
      content,
      kind: options.kind,
      scope: options.scope,
      sessionId: options.session,
    });
    print(memory);
  });

program
  .command("recall")
  .description("Recupera memorias del proyecto")
  .argument("<query>", "Consulta")
  .action(async (query: string) => {
    if (v1()) return memoryV1(process.cwd(), "recall", query, {}, print);
    const project = loadProject();
    print(await projectApi(project.manifest).recall(project.manifest.projectId, query));
  });

program
  .command("memories")
  .description("Lista las memorias del proyecto")
  .action(async () => {
    if (v1()) return memoryV1(process.cwd(), "list", undefined, {}, print);
    const project = loadProject();
    print(await projectApi(project.manifest).listMemories(project.manifest.projectId));
  });

program
  .command("memory-update")
  .description("Actualiza una memoria por ID")
  .argument("<id>")
  .argument("<content>")
  .option("--kind <kind>")
  .option("--scope <scope>")
  .action(async (id: string, content: string, options: { kind?: string; scope?: string }) => {
    if (v1()) throw new Error("En proyectos v1 con memoria local, elimina la memoria con 'modai forget' y crea una nueva con 'modai remember'");
    const project = loadProject();
    print(await projectApi(project.manifest).updateMemory(id, { content, kind: options.kind, scope: options.scope }));
  });

program
  .command("forget")
  .description("Elimina una memoria por ID")
  .argument("<id>")
  .action(async (id: string) => {
    if (v1()) return memoryV1(process.cwd(), "forget", id, {}, print);
    const project = loadProject();
    await projectApi(project.manifest).deleteMemory(id);
    print(`Memoria eliminada: ${id}`);
  });

program
  .command("update")
  .description("Actualiza dependencias dentro de los rangos de modai.yaml")
  .argument("[packages...]", "Paquetes a actualizar; por defecto todos")
  .action(async (names: string[] = []) => {
    if (v1()) return updateV1(process.cwd(), names, print);
    const project = loadProject();
    const before = new Map(project.lock.packages.map((item) => [item.name, item.version]));
    const result = await synchronize(projectApi(project.manifest), project.paths.root, project.manifest, project.lock);
    writeYaml(project.paths.lock, result.lock);
    const changed = result.lock.packages.filter((item) => before.get(item.name) !== item.version).map((item) => `${item.name}: ${before.get(item.name) ?? "nuevo"} -> ${item.version}`);
    print({ updated: changed, installed: result.lock.packages.length, preserved: result.preserved });
  });

program
  .command("outdated")
  .description("Compara el lock con las versiones disponibles en los registries")
  .action(async () => {
    if (v1()) return outdatedV1(process.cwd(), print);
    const project = loadProject();
    const available = await projectApi(project.manifest).listPackages();
    const rows = project.lock.packages.map((locked) => {
      const versions = available.filter((item) => item.name === locked.name && item.status !== "yanked").map((item) => item.version).filter((version) => semver.valid(version));
      const latest = versions.sort(semver.rcompare)[0] ?? locked.version;
      return { name: locked.name, current: locked.version, latest, outdated: semver.lt(locked.version, latest) };
    });
    print(rows);
  });

program
  .command("override")
  .description("Fija una versión o rango incluso si es una dependencia transitiva")
  .argument("<package>")
  .argument("<range>")
  .action(async (name: string, range: string) => {
    if (!semver.validRange(range)) throw new Error(`Rango SemVer inválido: ${range}`);
    if (v1()) { const { report } = await runSync(process.cwd(), file => { file.overrides[name] = range; }); print(`Override aplicado: ${name}@${range}\n${summarize(report)}`); return; }
    const project = loadProject();
    const next = structuredClone(project.manifest);
    next.overrides = { ...(next.overrides ?? {}), [name]: range };
    const result = await synchronize(projectApi(next), project.paths.root, next, project.lock);
    writeYaml(project.paths.manifest, next);
    writeYaml(project.paths.lock, result.lock);
    print(`Override aplicado: ${name}@${range}`);
  });

program
  .command("deprecate")
  .description("Marca una versión como deprecada")
  .argument("<package>", "@scope/name@version")
  .requiredOption("--message <message>")
  .action(async (spec: string, options: { message: string }) => {
    const item = splitPackageSpec(spec);
    if (!semver.valid(item.range)) throw new Error("Debes indicar una versión exacta.");
    const connection = effectiveConnection();
    print(await new ApiClient(connection.server, connection.token).deprecate(item.name, item.range, options.message));
  });

program
  .command("yank")
  .description("Retira una versión de nuevas resoluciones")
  .argument("<package>", "@scope/name@version")
  .requiredOption("--reason <reason>")
  .action(async (spec: string, options: { reason: string }) => {
    const item = splitPackageSpec(spec);
    if (!semver.valid(item.range)) throw new Error("Debes indicar una versión exacta.");
    const connection = effectiveConnection();
    print(await new ApiClient(connection.server, connection.token).yank(item.name, item.range, options.reason));
  });

program
  .command("unpublish")
  .description("Elimina definitivamente una versión previamente retirada")
  .argument("<package>", "@scope/name@version")
  .option("--confirm", "Confirma la eliminación irreversible")
  .action(async (spec: string, options: { confirm?: boolean }) => {
    if (!options.confirm) throw new Error("Operación irreversible: repite con --confirm después de ejecutar yank.");
    const item = splitPackageSpec(spec);
    if (!semver.valid(item.range)) throw new Error("Debes indicar una versión exacta.");
    const connection = effectiveConnection();
    await new ApiClient(connection.server, connection.token).hardDelete(item.name, item.range);
    print(`Eliminado definitivamente ${item.name}@${item.range}.`);
  });

const packageCommand = program.command("package").description("Herramientas de autoría de paquetes");
packageCommand.command("scaffold")
  .description("Crea un paquete con la especificación v1")
  .argument("<directory>")
  .requiredOption("--name <name>", "@scope/name")
  .option("--kind <kind>", "package, profile o adapter", "package")
  .option("--category <category>", "Categoría informativa: frontend, testing, iot... (el Core no la interpreta)")
  .option("--with-tool", "Incluye una herramienta ejecutable de ejemplo")
  .option("--type <type>", `Formato 0.5 (obsoleto): ${PACKAGE_TYPES.join(", ")}`)
  .action((directory: string, options: { name: string; kind?: string; category?: string; withTool?: boolean; type?: string }) => {
    if (options.type) {
      if (!PACKAGE_TYPES.includes(options.type as PackageType)) throw new Error(`Tipo inválido: ${options.type}`);
      print(`Paquete 0.5 creado en ${scaffoldPackage(directory, options.name, options.type as PackageType)}`);
      return;
    }
    print(`Paquete creado en ${scaffoldV1(directory, options)}\nValida con: modai package validate ${directory}`);
  });
packageCommand.command("validate")
  .argument("[directory]", "Carpeta del paquete", ".")
  .action((directory: string) => {
    const input = loadPackageSource(resolve(directory));
    parseInput(publishSchema, input);
    validatePackage(input.manifest, input.files);
    const quality = analyzePackageQuality(input.manifest, input.files);
    print(quality);
    if (quality.findings.some((item) => item.severity === "error")) process.exitCode = 1;
  });
packageCommand.command("keygen")
  .argument("[directory]", "Carpeta de salida", ".modai/keys")
  .action((directory: string) => print(generateSigningKey(directory)));

const harnessCommand = program.command("harness").description("Crea y audita harnesses de cinco subsistemas");
harnessCommand.command("init")
  .argument("[directory]", "Proyecto", ".")
  .option("--agent-file <name>", "AGENTS.md o CLAUDE.md", "AGENTS.md")
  .option("--force", "Reemplaza artefactos existentes")
  .action((directory: string, options: { agentFile: string; force?: boolean }) => print({ created: createHarness(directory, options.agentFile, options.force ?? false) }));
harnessCommand.command("audit")
  .argument("[directory]", "Proyecto", ".")
  .action((directory: string) => print(auditHarness(directory)));

const adminCommand = program.command("admin").description("Administración del servidor");
adminCommand.command("export")
  .argument("<file>")
  .action(async (file: string) => {
    const connection = effectiveConnection();
    const snapshot = await new ApiClient(connection.server, connection.token).exportBackup();
    writeFileSync(resolve(file), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    print(`Backup exportado a ${resolve(file)}`);
  });
adminCommand.command("import")
  .argument("<file>")
  .action(async (file: string) => {
    const connection = effectiveConnection();
    print(await new ApiClient(connection.server, connection.token).importBackup(JSON.parse(readFileSync(resolve(file), "utf8"))));
  });
adminCommand.command("create-key")
  .requiredOption("--label <label>")
  .option("--role <role>", "reader, publisher, worker o admin", "reader")
  .option("--projects <ids>", "Proyectos autorizados", commaList)
  .option("--organizations <ids>", "Organizaciones autorizadas", commaList)
  .option("--scopes <scopes>", "Namespaces publicables, por ejemplo @skills", commaList)
  .action(async (options: { label: string; role: string; projects?: string[]; organizations?: string[]; scopes?: string[] }) => {
    const connection = effectiveConnection();
    print(await new ApiClient(connection.server, connection.token).createApiKey(options.label, options.role, { projectIds: options.projects, organizationIds: options.organizations, packageScopes: options.scopes }));
  });
adminCommand.command("prune")
  .option("--memory-days <days>", "Retención de memorias", "365")
  .option("--audit-days <days>", "Retención de auditoría", "90")
  .action(async (options: { memoryDays: string; auditDays: string }) => {
    const connection = effectiveConnection();
    print(await new ApiClient(connection.server, connection.token).prune(Number(options.memoryDays), Number(options.auditDays)));
  });

const projectCommand = program.command("project").description("Registro de proyectos del servidor");
projectCommand.command("list").action(async () => { const c=effectiveConnection();print(await new ApiClient(c.server,c.token).projects()); });
projectCommand.command("register").action(async () => { const p=loadProject(),api=projectApi(p.manifest);print(await api.createProject({id:p.manifest.projectId,name:basename(p.paths.root)})); });
adminCommand.command("grant-key").argument("<id>").option("--projects <ids>","Proyectos",commaList).option("--organizations <ids>","Organizaciones",commaList).option("--scopes <scopes>","Namespaces",commaList).action(async(id,options)=>{const c=effectiveConnection();await new ApiClient(c.server,c.token).updateKeyGrants(id,{projectIds:options.projects??[],organizationIds:options.organizations??[],packageScopes:options.scopes??[]});print("Grants reemplazados");});
adminCommand.command("create-project").requiredOption("--name <name>").option("--organization <id>").action(async options => {const c=effectiveConnection();print(await new ApiClient(c.server,c.token).createProject({name:options.name,organizationId:options.organization}));});
adminCommand.command("create-organization").argument("<name>").action(async name => {const c=effectiveConnection();print(await new ApiClient(c.server,c.token).createOrganization(name));});
adminCommand.command("trust-publisher").argument("<public-key>").option("--label <label>","Nombre del publicador","publisher").action(async (path,options)=>{const c=effectiveConnection();print(await new ApiClient(c.server,c.token).registerPublisher(readFileSync(resolve(path),"utf8"),options.label,true));});
program.command("trust").argument("<public-key>","Clave pública Ed25519 que se autoriza en este equipo").action(path=>{const config=loadClientConfig();if(!config)throw new Error("Conecta primero la CLI");const fingerprint=publicKeyFingerprint(readFileSync(resolve(path),"utf8"));config.trustedPublishers=[...new Set([...(config.trustedPublishers??[]),fingerprint])];saveClientConfig(config);print({trustedPublisher:fingerprint});});
program.command("signatures").argument("<policy>","optional, signed o trusted").action(value=>{const config=loadClientConfig();if(!config)throw new Error("Conecta primero la CLI");config.signaturePolicy=signaturePolicySchema.parse(value);saveClientConfig(config);print({signaturePolicy:config.signaturePolicy});});
registerV1Commands(program, print);
registerListCommands(program, print, commaList);
registerAgentCommands(program, () => {let project:ReturnType<typeof loadProject>|undefined;try{project=loadProject()}catch{}return effectiveConnection(project?.manifest.server)}, print);

registerClientCommands(program, () => {
  let project: ReturnType<typeof loadProject> | undefined;
  try { project = loadProject(); } catch {}
  if (project) return projectApi(project.manifest);
  const connection = effectiveConnection();
  return new ApiClient(connection.server, connection.token);
}, print);

program.configureOutput({ outputError: (message) => process.stderr.write(message) });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
