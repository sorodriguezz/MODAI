import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import semver from "semver";
import { ApiClient } from "@modai/sdk";
import { signaturePolicySchema } from "@modai/contracts/schemas";
import { publicKeyFingerprint } from "@modai/contracts/security";
import { isV1Project, loadV1Project } from "@modai/core";
import { clientConfigPath, loadClientConfig, saveClientConfig } from "../config.js";
import { effectiveConnection } from "../connection.js";
import { readAccessToken } from "../credentials.js";
import { commaList } from "../agent-commands.js";
import { group } from "../groups.js";
import { formatTable, isJsonMode, type Print } from "../output.js";
import { confirm, tokenFor } from "../../v1/runtime.js";

const shellQuote = (value: string) => `'${value.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
const serverApi = () => { const connection = effectiveConnection(); return new ApiClient(connection.server, connection.token); };

interface Check { check: string; status: "ok" | "aviso" | "error"; detail: string }

/** Reachability, latency, version and credentials of a MODAI server (and the project's registries). */
export async function pingServer(target: string, cliVersion: string, options: { timeoutMs?: number; token?: string } = {}): Promise<Check[]> {
  const server = target.replace(/\/+$/, "");
  const checks: Check[] = [];
  const started = performance.now();
  let health: { status: string; version: string; apiVersion: number; publicUrl?: string };
  try {
    const response = await fetch(`${server}/health`, { signal: AbortSignal.timeout(options.timeoutMs ?? 5000), headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`respondió HTTP ${response.status}`);
    health = await response.json().catch(() => undefined) as typeof health;
  } catch (error) {
    const cause = (error as Error & { cause?: { code?: string; message?: string; errors?: Array<{ code?: string }> } }).cause;
    const code = cause?.code ?? cause?.errors?.[0]?.code;
    const reason = (error as Error).name === "TimeoutError" ? `sin respuesta en ${(options.timeoutMs ?? 5000) / 1000} s`
      : code === "ECONNREFUSED" ? "conexión rechazada: el servidor no está escuchando en esa dirección"
      : code === "ENOTFOUND" || code === "EAI_AGAIN" ? "el nombre no resuelve (DNS)"
      : /CERT|SSL|TLS/.test(code ?? "") ? `certificado HTTPS no válido (${code})`
      : `${(error as Error).message}${cause?.message ? `: ${cause.message}` : ""}`;
    return [{ check: "Servidor", status: "error", detail: `${server}: ${reason}` }];
  }
  const latency = Math.round(performance.now() - started);
  if (!health || typeof health.version !== "string" || typeof health.apiVersion !== "number") {
    return [{ check: "Servidor", status: "error", detail: `${server} responde (${latency} ms), pero no es un servidor MODAI: revisa la URL` }];
  }
  checks.push({ check: "Servidor", status: health.status === "ok" ? "ok" : "aviso", detail: `${server} · ${health.status} · ${latency} ms` });
  const same = semver.valid(health.version) && semver.valid(cliVersion) && semver.major(health.version) === semver.major(cliVersion) && semver.minor(health.version) === semver.minor(cliVersion);
  checks.push({ check: "Versión", status: health.apiVersion !== 1 ? "error" : same ? "ok" : "aviso",
    detail: health.apiVersion !== 1 ? `API v${health.apiVersion} incompatible con esta CLI` : `servidor ${health.version} · CLI ${cliVersion}${same ? "" : " (versiones distintas: actualiza el que esté atrás)"}` });
  if (options.token) {
    try {
      const session = await new ApiClient(server, options.token).session();
      checks.push({ check: "Credencial", status: "ok", detail: `${session.label} · ${session.role}` });
    } catch (error) {
      checks.push({ check: "Credencial", status: "error", detail: `rechazada (${(error as Error).message}). Vuelve a conectar con: modai server connect ${server}` });
    }
  } else checks.push({ check: "Credencial", status: "aviso", detail: `no hay API key guardada para este servidor: modai server connect ${server}` });
  return checks;
}

/** Connection to a central server, its projects, its administration and local trust settings. */
export function registerServerCommands(program: Command, print: Print): void {
  const server = program.command("server").description("Conexión con un servidor MODAI: conectar, comprobar y cerrar sesión");
  server.command("connect")
    .description("Conecta la CLI a un servidor MODAI")
    .argument("<url>", "URL del servidor")
    .option("--token <token>", "Token Bearer (prefiere la entrada oculta o --token-stdin)")
    .option("--token-stdin", "Lee la API key por stdin para automatizaciones")
    .action(async (url: string, options: { token?: string; tokenStdin?: boolean }) => {
      const target = url.replace(/\/+$/, "");
      if (options.token && options.tokenStdin) throw new Error("Usa --token o --token-stdin, no ambos");
      const token = options.token ?? (options.tokenStdin ? await readAccessToken(true) : effectiveConnection(target).token ?? await readAccessToken());
      const api = new ApiClient(target, token);
      await api.assertCompatible();
      const health = await api.health();
      const identity = await api.session();
      const projects = await api.projects();
      saveClientConfig({ ...loadClientConfig(), server: target, token });
      print(`Conectado a ${target} (MODAI ${health.version}) como ${identity.label} · ${identity.role}. Configuración: ${clientConfigPath}`);
      print(projects.length ? projects.map(project => `${project.name}: modai init --project ${shellQuote(project.id)}`).join("\n") : "No hay proyectos asignados. Pide acceso a quien administra el servidor.");
    });

  server.command("logout").alias("disconnect")
    .description("Cierra la sesión: olvida el servidor y la API key guardados en este equipo (para cambiar de servidor)")
    .action(() => {
      const config = loadClientConfig();
      if (!config?.server && !config?.token) { print("No había ninguna sesión guardada."); return; }
      const previous = config.server;
      const { server: _server, token: _token, ...rest } = config;
      // Trust settings (signature policy, trusted publishers) are about this machine, not the session.
      saveClientConfig(rest);
      const notes = [`Sesión cerrada${previous ? ` en ${previous}` : ""}. La API key se borró de ${clientConfigPath}.`];
      if (process.env.MODAI_API_TOKEN || process.env.MODAI_SERVER) notes.push("Ojo: MODAI_API_TOKEN o MODAI_SERVER siguen definidas en tu entorno y se seguirán usando; quítalas con unset.");
      const project = isV1Project(process.cwd()) ? loadV1Project() : undefined;
      if (previous && project?.file.context.server?.replace(/\/+$/, "") === previous.replace(/\/+$/, "")) notes.push(`Este proyecto sigue vinculado a ${previous} en modai.yaml; para moverlo, cambia context.server y su registry.`);
      notes.push("Para usar otro servidor: modai server connect <url>");
      print(notes.join("\n"));
    });

  server.command("keys").description("Tus API keys (las del usuario dueño de esta credencial). Se crean en el panel: Mis API keys")
    .action(async () => print((await new ApiClient(effectiveConnection().server, effectiveConnection().token).myApiKeys()).filter(key => !key.revokedAt)
      .map(key => ({ id: key.id, label: key.label, role: key.role, access: key.inherit ? "como tu cuenta" : "acotado", lastUsed: key.lastUsedAt ?? "nunca" }))));
  server.command("revoke-key").description("Revoca una de tus API keys (por ejemplo, la de un equipo perdido)").argument("<id>")
    .action(async (id: string) => { await new ApiClient(effectiveConnection().server, effectiveConnection().token).revokeMyApiKey(id); print(`API key revocada: ${id}`); });

  server.command("whoami").description("Muestra la identidad, su rol y lo que puede hacer en el servidor").action(async () => {
    const connection = effectiveConnection();
    const api = new ApiClient(connection.server, connection.token);
    const session = await api.session();
    const projects = (await api.projects()).map(project => ({ id: project.id, name: project.name }));
    const permissions = session.permissions;
    const yes = (value: boolean) => value ? "sí" : "no";
    print({
      server: connection.server, label: session.label, role: session.role,
      organizations: permissions.organizations.map(org => org.manage ? `${org.name} (administra)` : org.name),
      projects,
      publish: permissions.publish.all ? "todos los namespaces" : permissions.publish.namespaces.length ? permissions.publish.namespaces : "ninguno",
      can: {
        createProjects: yes(permissions.createProjects), writeMemory: yes(permissions.writeMemory), submitRuns: yes(permissions.submitRuns),
        manageUsersAndKeys: yes(permissions.manage.users), manageOrganizations: yes(permissions.manage.organizations), audit: yes(permissions.manage.audit),
      },
    });
  });

  server.command("ping")
    .description("Comprueba si el servidor está arriba: latencia, versión, credencial y registries del proyecto")
    .argument("[url]", "Servidor; por defecto el del proyecto o el conectado")
    .option("--timeout <ms>", "Tiempo máximo de espera por servidor", "5000")
    .action(async (url: string | undefined, options: { timeout: string }) => {
      const project = isV1Project(process.cwd()) ? loadV1Project() : undefined;
      const target = url ?? project?.file.context.server ?? process.env.MODAI_SERVER ?? loadClientConfig()?.server;
      const timeoutMs = Number(options.timeout);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error("--timeout debe estar entre 100 y 60000 ms");
      const checks: Check[] = target ? await pingServer(target, program.version()!, { timeoutMs, token: tokenFor(target.replace(/\/+$/, "")) }) : [];
      // The project's other registries: a server answers /health, a folder must be readable.
      for (const registry of project?.file.registries ?? []) {
        if (registry.url && target && registry.url.replace(/\/+$/, "") === target.replace(/\/+$/, "")) continue;
        if (registry.url) {
          const [first] = await pingServer(registry.url, program.version()!, { timeoutMs });
          checks.push({ ...first, check: `Registry ${registry.name}` });
        } else {
          const path = resolve(project!.root, registry.path!);
          try { accessSync(path, constants.R_OK); checks.push({ check: `Registry ${registry.name}`, status: "ok", detail: `carpeta ${path}` }); }
          catch { checks.push({ check: `Registry ${registry.name}`, status: "aviso", detail: `la carpeta ${path} no existe o no se puede leer (se crea al publicar)` }); }
        }
      }
      if (!checks.length) throw new Error("No hay servidor que comprobar: indica una URL (modai server ping https://…) o conecta la CLI con modai server connect");
      if (isJsonMode()) print(checks);
      else print(formatTable(checks.map(item => ({ "": item.status === "ok" ? "✓" : item.status === "aviso" ? "!" : "✗", check: item.check, detail: item.detail })), 300));
      if (checks.some(item => item.status === "error")) process.exitCode = 1;
    });

  const permissions = group(program, "permissions", "Qué permite este equipo: herramientas autorizadas, publicadores de confianza y política de firmas");
  permissions.command("trust").argument("<public-key>", "Clave pública Ed25519 que se autoriza en este equipo").description("Confía en un publicador para la política de firmas 'trusted'")
    .action((path: string) => {
      const config = loadClientConfig();
      if (!config) throw new Error("Conecta primero la CLI: modai server connect <url>");
      const fingerprint = publicKeyFingerprint(readFileSync(resolve(path), "utf8"));
      config.trustedPublishers = [...new Set([...(config.trustedPublishers ?? []), fingerprint])];
      saveClientConfig(config);
      print({ trustedPublisher: fingerprint });
    });
  permissions.command("signatures").argument("<policy>", "optional, signed o trusted").description("Política de firmas de este equipo")
    .action((value: string) => {
      const config = loadClientConfig();
      if (!config) throw new Error("Conecta primero la CLI: modai server connect <url>");
      config.signaturePolicy = signaturePolicySchema.parse(value);
      saveClientConfig(config);
      print({ signaturePolicy: config.signaturePolicy });
    });

  const project = program.command("project").description("Proyectos del servidor: listar, crear y eliminar");
  project.command("list", { isDefault: true }).alias("ls").description("Proyectos a los que tienes acceso").action(async () => {
    print((await serverApi().projects()).map(item => ({ id: item.id, name: item.name, organization: item.organizationId ?? "", created: item.createdAt })));
  });
  project.command("create").description("Crea un proyecto en el servidor")
    .requiredOption("--name <name>", "Nombre visible").option("--id <id>", "Identificador; por defecto se genera uno").option("--organization <id>", "Organización para compartir memoria")
    .action(async (options: { name: string; id?: string; organization?: string }) => {
      const created = await serverApi().createProject({ id: options.id, name: options.name, organizationId: options.organization });
      print(isJsonMode() ? created : `Proyecto ${created.name} creado (${created.id}).\nVincula un repositorio con: modai init --project ${shellQuote(created.id)}`);
    });
  project.command("delete").alias("rm").description("Elimina un proyecto con su memoria, ejecuciones y registro de instalaciones (irreversible)")
    .argument("<id>", "Identificador del proyecto")
    .option("--yes", "No pide confirmación (para scripts)")
    .action(async (id: string, options: { yes?: boolean }) => {
      const api = serverApi();
      const found = (await api.projects()).find(item => item.id === id);
      if (!found) throw new Error(`No existe el proyecto ${id} o no tienes acceso. Revisa los identificadores con: modai project list`);
      if (found.canDelete === false) throw new Error(`No puedes eliminar ${found.name}: solo un administrador o quien lo creó`);
      const question = `Se eliminará ${found.name} (${id}) con su memoria de proyecto, sus ejecuciones y su registro de instalaciones. La memoria de organización se conserva. No se puede deshacer. ¿Continuar?`;
      if (!(await confirm(question, options.yes))) { print("Sin cambios."); return; }
      const result = await api.deleteProject(id);
      print(isJsonMode() ? result : `Proyecto ${found.name} eliminado: ${result.memories} memorias y ${result.runs} ejecuciones borradas.\nLos repositorios vinculados conservan sus archivos; quita context.projectId de su modai.yaml o vincúlalos a otro proyecto.`);
    });

  const admin = program.command("admin").description("Administración del servidor");
  admin.command("export").argument("<file>").action(async (file: string) => {
    writeFileSync(resolve(file), `${JSON.stringify(await serverApi().exportBackup(), null, 2)}\n`, "utf8");
    print(`Backup exportado a ${resolve(file)}`);
  });
  admin.command("import").argument("<file>").action(async (file: string) => print(await serverApi().importBackup(JSON.parse(readFileSync(resolve(file), "utf8")))));
  admin.command("create-key").description("Crea una API key a nombre de un usuario, dentro de sus permisos (sin --owner: para tu usuario)")
    .requiredOption("--label <label>")
    .option("--owner <username|id>", "Usuario dueño de la key")
    .option("--role <role>", "reader, publisher, worker, org-admin o admin (como máximo el del dueño)", "reader")
    .option("--projects <ids>", "Acotar a estos proyectos", commaList)
    .option("--organizations <ids>", "Acotar a estas organizaciones", commaList)
    .option("--scopes <scopes>", "Acotar a estos namespaces, por ejemplo @skills", commaList)
    .option("--service", "Key de servicio sin dueño (solo con el token de instalación o administración global)")
    .action(async (options: { label: string; owner?: string; role: string; projects?: string[]; organizations?: string[]; scopes?: string[]; service?: boolean }) => {
      const api = serverApi();
      const wanted = options.owner;
      const owner = wanted ? (await api.users()).find(user => user.id === wanted || user.username === wanted.toLowerCase()) : undefined;
      if (options.owner && !owner) throw new Error(`No administras un usuario llamado ${options.owner}`);
      const key = await api.createApiKey(options.label, options.role, { projectIds: options.projects, organizationIds: options.organizations, packageScopes: options.scopes }, options.service ? { ownerId: null } : owner ? { ownerId: owner.id } : {});
      print({ id: key.id, label: key.label, role: key.role, owner: key.ownerName ?? "sin dueño", access: key.inherit ? "los mismos que su dueño" : "acotado", token: key.token });
    });
  admin.command("grant-key").argument("<id>")
    .option("--projects <ids>", "Proyectos", commaList).option("--organizations <ids>", "Organizaciones", commaList).option("--scopes <scopes>", "Namespaces", commaList)
    .action(async (id: string, options: { projects?: string[]; organizations?: string[]; scopes?: string[] }) => {
      await serverApi().updateKeyGrants(id, { projectIds: options.projects ?? [], organizationIds: options.organizations ?? [], packageScopes: options.scopes ?? [] });
      print("Accesos de la API key reemplazados.");
    });
  admin.command("create-organization").argument("<name>").option("--description <text>", "Descripción")
    .action(async (name: string, options: { description?: string }) => print(await serverApi().createOrganization(name, options.description)));
  admin.command("organizations").description("Organizaciones visibles con sus proyectos, namespaces y miembros")
    .action(async () => print((await serverApi().organizations()).map(org => ({ id: org.id, name: org.name, projects: org.projects, namespaces: org.namespaces, members: org.members, manage: org.canManage }))));
  admin.command("namespaces").description("Namespaces de paquetes, su organización y visibilidad")
    .action(async () => print((await serverApi().namespaces()).map(ns => ({ name: ns.name, organization: ns.organizationName ?? "—", visibility: ns.visibility, packages: ns.packages, publish: ns.canPublish }))));
  admin.command("create-namespace").argument("<name>", "Por ejemplo @acme-pagos")
    .option("--organization <id>", "Organización dueña")
    .option("--restricted", "Solo quien tenga el namespace asignado ve sus paquetes")
    .option("--description <text>", "Descripción")
    .action(async (name: string, options: { organization?: string; restricted?: boolean; description?: string }) =>
      print(await serverApi().createNamespace({ name, organizationId: options.organization, visibility: options.restricted ? "restricted" : "internal", description: options.description })));
  admin.command("trust-publisher").argument("<public-key>").option("--label <label>", "Nombre del publicador", "publisher")
    .action(async (path: string, options: { label: string }) => print(await serverApi().registerPublisher(readFileSync(resolve(path), "utf8"), options.label, true)));
  admin.command("prune").description("Borra memorias y/o eventos de auditoría antiguos (sin opciones: memorias de más de 365 días y auditoría de más de 90)")
    .option("--memory-days <days>", "Borra memorias sin cambios hace más de N días (0 = todas)")
    .option("--audit-days <days>", "Borra eventos de auditoría de hace más de N días (0 = todos)")
    .option("--dry-run", "Solo cuenta lo que se borraría")
    .action(async (options: { memoryDays?: string; auditDays?: string; dryRun?: boolean }) => {
      const neither = options.memoryDays === undefined && options.auditDays === undefined;
      const memoryDays = neither ? 365 : options.memoryDays === undefined ? undefined : Number(options.memoryDays);
      const auditDays = neither ? 90 : options.auditDays === undefined ? undefined : Number(options.auditDays);
      const result = await serverApi().prune(memoryDays, auditDays, options.dryRun);
      print(`${result.dryRun ? "Se borrarían" : "Borrados"}: ${result.memories} memorias y ${result.audit} eventos de auditoría.`);
    });
}
