import { isV1Project, loadV1Project } from "@modai/core";
import { ApiClient } from "@modai/sdk";
import { loadClientConfig } from "./config.js";

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|.+\.localhost)$/i;
const INSECURE_REFUSAL = "No se envían credenciales";

export function insecureTransport(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.protocol === "http:" && !LOCAL_HOST.test(parsed.hostname) && process.env.MODAI_ALLOW_INSECURE_HTTP !== "1"
  );
}

export function effectiveConnection(server?: string): { server: string; token?: string } {
  const config = loadClientConfig();
  const value = server ?? process.env.MODAI_SERVER ?? config?.server;
  if (!value) throw new Error("No hay servidor configurado. Ejecuta modai server connect <url>");
  const normalize = (url: string) => new URL(url).href.replace(/\/+$/, "");
  const same = (other?: string) => Boolean(other) && normalize(other!) === normalize(value);
  const envServer = process.env.MODAI_SERVER || config?.server;
  // why: a credential only goes to the server it was issued for, and never over plain http
  const token =
    (process.env.MODAI_API_TOKEN && same(envServer) ? process.env.MODAI_API_TOKEN : undefined) ??
    (same(config?.server) ? config?.token : undefined);
  if (token && insecureTransport(value))
    throw new Error(
      `${INSECURE_REFUSAL} por http a ${new URL(value).host}: usa https (o MODAI_ALLOW_INSECURE_HTTP=1 si es una red de confianza).`,
    );
  return { server: value.replace(/\/+$/, ""), token };
}

export function tokenFor(url: string): string | undefined {
  try {
    return effectiveConnection(url).token;
  } catch (error) {
    if ((error as Error).message.startsWith(INSECURE_REFUSAL)) throw error;
    return undefined;
  }
}

export function serverApi(): ApiClient {
  const connection = effectiveConnection();
  return new ApiClient(connection.server, connection.token);
}

export function projectOrServerApi(): ApiClient {
  const server = isV1Project(process.cwd()) ? loadV1Project().file.context.server : undefined;
  if (server) return new ApiClient(server, tokenFor(server));
  return serverApi();
}
