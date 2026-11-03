import { loadClientConfig } from "./config.js";

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|.+\.localhost)$/i;

/** Plain http to anything but this machine: credentials would travel unencrypted. MODAI_ALLOW_INSECURE_HTTP=1 accepts it (trusted network). */
export function insecureTransport(url: string): boolean {
  const parsed = new URL(url);
  return parsed.protocol === "http:" && !LOCAL_HOST.test(parsed.hostname) && process.env.MODAI_ALLOW_INSECURE_HTTP !== "1";
}

/**
 * The server to talk to and the credential for it. A credential only goes to the server it belongs to: MODAI_API_TOKEN to
 * MODAI_SERVER (or the configured server when MODAI_SERVER is unset) and the saved token to the server it was saved for.
 * A registry named by a repository's modai.yaml or a template gets no credential, and none is sent over plain http.
 */
export function effectiveConnection(server?: string): { server: string; token?: string } {
  const config = loadClientConfig();
  const value = server ?? process.env.MODAI_SERVER ?? config?.server;
  if (!value) throw new Error("No hay servidor configurado. Ejecuta modai server connect <url>");
  const normalize = (url: string) => new URL(url).href.replace(/\/+$/, "");
  const same = (other?: string) => Boolean(other) && normalize(other!) === normalize(value);
  const envServer = process.env.MODAI_SERVER || config?.server;
  const token = (process.env.MODAI_API_TOKEN && same(envServer) ? process.env.MODAI_API_TOKEN : undefined) ?? (same(config?.server) ? config?.token : undefined);
  if (token && insecureTransport(value)) throw new Error(`No se envían credenciales por http a ${new URL(value).host}: usa https (o MODAI_ALLOW_INSECURE_HTTP=1 si es una red de confianza).`);
  return { server: value.replace(/\/+$/, ""), token };
}
