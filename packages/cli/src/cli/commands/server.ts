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
import { formatTable, isJsonMode, type Print } from "../output.js";
import { tokenFor } from "../../v1/runtime.js";

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
      checks.push({ check: "Credencial", status: "error", detail: `rechazada (${(error as Error).message}). Vuelve a conectar con: modai connect ${server}` });
    }
  } else checks.push({ check: "Credencial", status: "aviso", detail: `no hay API key guardada para este servidor: modai connect ${server}` });
  return checks;
}

/** Connection to a central server, its administration and local trust settings. */
export function registerServerCommands(program: Command, print: Print): void {
  program.command("connect")
    .description("Conecta la CLI a un servidor MODAI")
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
      print(`Conectado a ${server} (MODAI ${health.version}) como ${identity.label} · ${identity.role}. Configuración: ${clientConfigPath}`);
      print(projects.length ? projects.map(project => `${project.name}: modai init --project ${shellQuote(project.id)}`).join("\n") : "No hay proyectos asignados. Pide acceso a quien administra el servidor.");
    });

  program.command("logout").alias("disconnect")
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
      notes.push("Para usar otro servidor: modai connect <url>");
      print(notes.join("\n"));
    });

  program.command("whoami").description("Muestra la identidad y los proyectos autorizados").action(async () => {
    const connection = effectiveConnection();
    const api = new ApiClient(connection.server, connection.token);
    const session = await api.session();
    print({ server: connection.server, label: session.label, role: session.role, projects: (await api.projects()).map(project => ({ id: project.id, name: project.name })) });
  });

  program.command("ping")
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
      if (!checks.length) throw new Error("No hay servidor que comprobar: indica una URL (modai ping https://…) o conecta la CLI con modai connect");
      if (isJsonMode()) print(checks);
      else print(formatTable(checks.map(item => ({ "": item.status === "ok" ? "✓" : item.status === "aviso" ? "!" : "✗", check: item.check, detail: item.detail })), 300));
      if (checks.some(item => item.status === "error")) process.exitCode = 1;
    });

  program.command("trust").argument("<public-key>", "Clave pública Ed25519 que se autoriza en este equipo").description("Confía en un publicador para la política de firmas 'trusted'")
    .action((path: string) => {
      const config = loadClientConfig();
      if (!config) throw new Error("Conecta primero la CLI");
      const fingerprint = publicKeyFingerprint(readFileSync(resolve(path), "utf8"));
      config.trustedPublishers = [...new Set([...(config.trustedPublishers ?? []), fingerprint])];
      saveClientConfig(config);
      print({ trustedPublisher: fingerprint });
    });
  program.command("signatures").argument("<policy>", "optional, signed o trusted").description("Política de firmas de este equipo")
    .action((value: string) => {
      const config = loadClientConfig();
      if (!config) throw new Error("Conecta primero la CLI");
      config.signaturePolicy = signaturePolicySchema.parse(value);
      saveClientConfig(config);
      print({ signaturePolicy: config.signaturePolicy });
    });

  program.command("project").description("Proyectos del servidor").command("list").action(async () => {
    print((await serverApi().projects()).map(project => ({ id: project.id, name: project.name, organization: project.organizationId })));
  });

  const admin = program.command("admin").description("Administración del servidor");
  admin.command("export").argument("<file>").action(async (file: string) => {
    writeFileSync(resolve(file), `${JSON.stringify(await serverApi().exportBackup(), null, 2)}\n`, "utf8");
    print(`Backup exportado a ${resolve(file)}`);
  });
  admin.command("import").argument("<file>").action(async (file: string) => print(await serverApi().importBackup(JSON.parse(readFileSync(resolve(file), "utf8")))));
  admin.command("create-key")
    .requiredOption("--label <label>")
    .option("--role <role>", "reader, publisher, worker o admin", "reader")
    .option("--projects <ids>", "Proyectos autorizados", commaList)
    .option("--organizations <ids>", "Organizaciones autorizadas", commaList)
    .option("--scopes <scopes>", "Namespaces publicables, por ejemplo @skills", commaList)
    .action(async (options: { label: string; role: string; projects?: string[]; organizations?: string[]; scopes?: string[] }) => {
      print(await serverApi().createApiKey(options.label, options.role, { projectIds: options.projects, organizationIds: options.organizations, packageScopes: options.scopes }));
    });
  admin.command("grant-key").argument("<id>")
    .option("--projects <ids>", "Proyectos", commaList).option("--organizations <ids>", "Organizaciones", commaList).option("--scopes <scopes>", "Namespaces", commaList)
    .action(async (id: string, options: { projects?: string[]; organizations?: string[]; scopes?: string[] }) => {
      await serverApi().updateKeyGrants(id, { projectIds: options.projects ?? [], organizationIds: options.organizations ?? [], packageScopes: options.scopes ?? [] });
      print("Accesos de la API key reemplazados.");
    });
  admin.command("create-project").requiredOption("--name <name>").option("--organization <id>")
    .action(async (options: { name: string; organization?: string }) => print(await serverApi().createProject({ name: options.name, organizationId: options.organization })));
  admin.command("create-organization").argument("<name>").action(async (name: string) => print(await serverApi().createOrganization(name)));
  admin.command("trust-publisher").argument("<public-key>").option("--label <label>", "Nombre del publicador", "publisher")
    .action(async (path: string, options: { label: string }) => print(await serverApi().registerPublisher(readFileSync(resolve(path), "utf8"), options.label, true)));
  admin.command("prune")
    .option("--memory-days <days>", "Retención de memorias", "365")
    .option("--audit-days <days>", "Retención de auditoría", "90")
    .action(async (options: { memoryDays: string; auditDays: string }) => print(await serverApi().prune(Number(options.memoryDays), Number(options.auditDays))));
}
