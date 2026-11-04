import { ApiClient } from "@modai/sdk";
import semver from "semver";

export interface Check {
  check: string;
  status: "ok" | "aviso" | "error";
  detail: string;
}

type Health = { status: string; version: string; apiVersion: number; publicUrl?: string };
type NetworkCause = { code?: string; message?: string; errors?: Array<{ code?: string }> };

function failureReason(error: Error, timeoutMs: number): string {
  const cause = (error as Error & { cause?: NetworkCause }).cause;
  const code = cause?.code ?? cause?.errors?.[0]?.code;
  if (error.name === "TimeoutError") return `sin respuesta en ${timeoutMs / 1000} s`;
  if (code === "ECONNREFUSED") return "conexión rechazada: el servidor no está escuchando en esa dirección";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "el nombre no resuelve (DNS)";
  if (/CERT|SSL|TLS/.test(code ?? "")) return `certificado HTTPS no válido (${code})`;
  return `${error.message}${cause?.message ? `: ${cause.message}` : ""}`;
}

async function fetchHealth(server: string, timeoutMs: number): Promise<Health> {
  const response = await fetch(`${server}/health`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`respondió HTTP ${response.status}`);
  return (await response.json().catch(() => undefined)) as Health;
}

function versionCheck(health: Health, cliVersion: string): Check {
  const same =
    semver.valid(health.version) &&
    semver.valid(cliVersion) &&
    semver.major(health.version) === semver.major(cliVersion) &&
    semver.minor(health.version) === semver.minor(cliVersion);
  if (health.apiVersion !== 1)
    return { check: "Versión", status: "error", detail: `API v${health.apiVersion} incompatible con esta CLI` };
  return {
    check: "Versión",
    status: same ? "ok" : "aviso",
    detail: `servidor ${health.version} · CLI ${cliVersion}${same ? "" : " (versiones distintas: actualiza el que esté atrás)"}`,
  };
}

async function credentialCheck(server: string, token?: string): Promise<Check> {
  if (!token)
    return {
      check: "Credencial",
      status: "aviso",
      detail: `no hay API key guardada para este servidor: modai server connect ${server}`,
    };
  try {
    const session = await new ApiClient(server, token).session();
    return { check: "Credencial", status: "ok", detail: `${session.label} · ${session.role}` };
  } catch (error) {
    return {
      check: "Credencial",
      status: "error",
      detail: `rechazada (${(error as Error).message}). Vuelve a conectar con: modai server connect ${server}`,
    };
  }
}

export async function pingServer(
  target: string,
  cliVersion: string,
  options: { timeoutMs?: number; token?: string } = {},
): Promise<Check[]> {
  const server = target.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 5000;
  const started = performance.now();
  let health: Health;
  try {
    health = await fetchHealth(server, timeoutMs);
  } catch (error) {
    return [{ check: "Servidor", status: "error", detail: `${server}: ${failureReason(error as Error, timeoutMs)}` }];
  }
  const latency = Math.round(performance.now() - started);
  if (!health || typeof health.version !== "string" || typeof health.apiVersion !== "number") {
    return [
      {
        check: "Servidor",
        status: "error",
        detail: `${server} responde (${latency} ms), pero no es un servidor MODAI: revisa la URL`,
      },
    ];
  }
  return [
    {
      check: "Servidor",
      status: health.status === "ok" ? "ok" : "aviso",
      detail: `${server} · ${health.status} · ${latency} ms`,
    },
    versionCheck(health, cliVersion),
    await credentialCheck(server, options.token),
  ];
}
