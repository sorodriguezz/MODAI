#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import semver from "semver";
import { analyzePackageQuality } from "../core/package-quality.js";
import { PACKAGE_TYPES, type PackageType } from "../core/types.js";
import { ApiClient } from "./api.js";
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
import { registerClientCommands } from "./client-commands.js";

function splitPackageSpec(spec: string): { name: string; range: string } {
  const separator = spec.lastIndexOf("@");
  if (!spec.startsWith("@") || !spec.includes("/")) throw new Error(`Paquete inválido: ${spec}. Usa @scope/nombre[@rango].`);
  if (separator > spec.indexOf("/")) return { name: spec.slice(0, separator), range: spec.slice(separator + 1) || "*" };
  return { name: spec, range: "*" };
}

function effectiveConnection(server?: string): { server: string; token?: string } {
  const global = loadClientConfig();
  const value = server ?? process.env.MODAI_SERVER ?? global?.server;
  if (!value) throw new Error(`No hay servidor configurado. Ejecuta 'modai connect http://host:8787'.`);
  return { server: value, token: process.env.MODAI_API_TOKEN ?? global?.token };
}

function projectApi(manifest: ProjectManifest): ApiClient {
  const connection = effectiveConnection(manifest.server);
  return new ApiClient(connection.server, connection.token);
}

function print(value: unknown): void {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}

const program = new Command();
program.name("modai").description("CLI de ModularAI").version("0.4.0");

program
  .command("connect")
  .description("Conecta la CLI a un servidor ModularAI")
  .argument("<url>", "URL del servidor")
  .option("--token <token>", "Token Bearer opcional")
  .action(async (url: string, options: { token?: string }) => {
    const server = url.replace(/\/+$/, "");
    const api = new ApiClient(server, options.token);
    const health = await api.health();
    await api.listPackages();
    saveClientConfig({ server, token: options.token });
    print(`Conectado a ${server} (ModularAI ${health.version}). Configuración: ${clientConfigPath}`);
  });

program
  .command("init")
  .description("Inicializa ModularAI en el proyecto actual")
  .option("--profile <package>", "Perfil instalable, por ejemplo @profiles/backend-architect")
  .option("--server <url>", "Servidor específico para este proyecto")
  .action(async (options: { profile?: string; server?: string }) => {
    const paths = projectPaths();
    if (existsSync(paths.manifest)) throw new Error("El proyecto ya está inicializado.");
    const connection = effectiveConnection(options.server);
    const api = new ApiClient(connection.server, connection.token);
    await api.health();
    const manifest = createManifest(connection.server);
    if (options.profile) {
      const profile = splitPackageSpec(options.profile);
      manifest.packages[profile.name] = profile.range;
    }
    const emptyLock = { schemaVersion: 1 as const, generatedAt: new Date(0).toISOString(), packages: [] };
    const result = await synchronize(api, paths.root, manifest, emptyLock);
    writeYaml(paths.manifest, manifest);
    writeYaml(paths.lock, result.lock);
    writeYaml(paths.config, { schemaVersion: 1, server: connection.server, projectId: manifest.projectId });
    print(`Proyecto ${manifest.projectId} inicializado${options.profile ? ` con ${options.profile}` : ""}.`);
  });

program
  .command("add")
  .description("Añade una capacidad y sus dependencias")
  .argument("<package>", "@scope/nombre[@rango]")
  .action(async (spec: string) => {
    const project = loadProject();
    const item = splitPackageSpec(spec);
    const next = structuredClone(project.manifest);
    next.packages[item.name] = item.range;
    const result = await synchronize(projectApi(next), project.paths.root, next, project.lock);
    writeYaml(project.paths.manifest, next);
    writeYaml(project.paths.lock, result.lock);
    print(`Instalado ${item.name}@${item.range}. ${result.lock.packages.length} paquete(s) resuelto(s).`);
  });

program
  .command("remove")
  .description("Retira una capacidad directa conservando archivos modificados")
  .argument("<package>", "@scope/nombre")
  .action(async (name: string) => {
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
  .description("Sincroniza el proyecto con manifest.yaml")
  .action(async () => {
    const project = loadProject();
    const result = await synchronize(projectApi(project.manifest), project.paths.root, project.manifest, project.lock);
    writeYaml(project.paths.lock, result.lock);
    print(`Sincronizado: ${result.lock.packages.length} paquete(s).${result.preserved.length ? ` Conservados: ${result.preserved.join(", ")}` : ""}`);
  });

program
  .command("status")
  .description("Muestra el estado del proyecto")
  .action(() => {
    const project = loadProject();
    print({
      projectId: project.manifest.projectId,
      server: project.manifest.server ?? loadClientConfig()?.server,
      requested: project.manifest.packages,
      overrides: project.manifest.overrides ?? {},
      installed: project.lock.packages.map(({ name, version, files }) => ({ name, version, files: files.length })),
    });
  });

program
  .command("registry")
  .description("Lista paquetes del registro")
  .option("--query <text>", "Filtro de texto")
  .option("--all", "Incluye versiones retiradas")
  .action(async (options: { query?: string; all?: boolean }) => {
    const connection = effectiveConnection();
    const packages = await new ApiClient(connection.server, connection.token).listPackages(options.query, options.all);
    print(packages.map(({ name, version, type, status, description, quality, signerFingerprint }) => ({ name, version, type, status, quality: quality?.score, signedBy: signerFingerprint, description })));
  });

program
  .command("publish")
  .description("Publica un paquete desde una carpeta")
  .argument("[directory]", "Carpeta del paquete", ".")
  .option("--key <private-key>", "Firma el paquete con una clave privada Ed25519")
  .action(async (directory: string, options: { key?: string }) => {
    const connection = effectiveConnection();
    let input = loadPackageSource(resolve(directory));
    if (options.key) input = signPackage(input, readFileSync(resolve(options.key), "utf8"));
    const published = await new ApiClient(connection.server, connection.token).publish(input);
    print(`Publicado ${published.name}@${published.version} (${published.artifactId}), calidad ${published.quality?.score ?? "legacy"}/100${published.signerFingerprint ? ", firmado" : ""}.`);
  });

program
  .command("search")
  .description("Busca conocimiento relevante")
  .argument("<query>", "Consulta")
  .action(async (query: string) => {
    const project = loadProject();
    const packageNames = project.lock.packages.map((item) => item.name);
    print(await projectApi(project.manifest).searchKnowledge(query, packageNames));
  });

program
  .command("remember")
  .description("Guarda una memoria del proyecto")
  .argument("<content>", "Contenido")
  .option("--kind <kind>", "Tipo de memoria", "note")
  .option("--scope <scope>", "Ámbito", "project")
  .action(async (content: string, options: { kind: string; scope: string }) => {
    const project = loadProject();
    const memory = await projectApi(project.manifest).remember({
      projectId: project.manifest.projectId,
      content,
      kind: options.kind,
      scope: options.scope,
    });
    print(memory);
  });

program
  .command("recall")
  .description("Recupera memorias del proyecto")
  .argument("<query>", "Consulta")
  .action(async (query: string) => {
    const project = loadProject();
    print(await projectApi(project.manifest).recall(project.manifest.projectId, query));
  });

program
  .command("memories")
  .description("Lista las memorias del proyecto")
  .action(async () => {
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
    const project = loadProject();
    print(await projectApi(project.manifest).updateMemory(id, { content, kind: options.kind, scope: options.scope }));
  });

program
  .command("forget")
  .description("Elimina una memoria por ID")
  .argument("<id>")
  .action(async (id: string) => {
    const project = loadProject();
    await projectApi(project.manifest).deleteMemory(id);
    print(`Memoria eliminada: ${id}`);
  });

program
  .command("update")
  .description("Actualiza dependencias dentro de los rangos del manifiesto")
  .action(async () => {
    const project = loadProject();
    const before = new Map(project.lock.packages.map((item) => [item.name, item.version]));
    const result = await synchronize(projectApi(project.manifest), project.paths.root, project.manifest, project.lock);
    writeYaml(project.paths.lock, result.lock);
    const changed = result.lock.packages.filter((item) => before.get(item.name) !== item.version).map((item) => `${item.name}: ${before.get(item.name) ?? "nuevo"} -> ${item.version}`);
    print({ updated: changed, installed: result.lock.packages.length, preserved: result.preserved });
  });

program
  .command("outdated")
  .description("Compara el lock con las versiones activas del registro")
  .action(async () => {
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
  .argument("<directory>")
  .requiredOption("--name <name>", "@scope/name")
  .option("--type <type>", `Tipo: ${PACKAGE_TYPES.join(", ")}`, "skill")
  .action((directory: string, options: { name: string; type: string }) => {
    if (!PACKAGE_TYPES.includes(options.type as PackageType)) throw new Error(`Tipo inválido: ${options.type}`);
    print(`Paquete creado en ${scaffoldPackage(directory, options.name, options.type as PackageType)}`);
  });
packageCommand.command("validate")
  .argument("[directory]", "Carpeta del paquete", ".")
  .action((directory: string) => {
    const input = loadPackageSource(resolve(directory));
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
  .option("--role <role>", "reader, publisher o admin", "reader")
  .action(async (options: { label: string; role: string }) => {
    const connection = effectiveConnection();
    print(await new ApiClient(connection.server, connection.token).createApiKey(options.label, options.role));
  });
adminCommand.command("prune")
  .option("--memory-days <days>", "Retención de memorias", "365")
  .option("--audit-days <days>", "Retención de auditoría", "90")
  .action(async (options: { memoryDays: string; auditDays: string }) => {
    const connection = effectiveConnection();
    print(await new ApiClient(connection.server, connection.token).prune(Number(options.memoryDays), Number(options.auditDays)));
  });

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
