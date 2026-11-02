import { loadClientConfig } from "./config.js";
export function effectiveConnection(server?: string): { server: string; token?: string } {
  const config = loadClientConfig();
  const value = server ?? process.env.MODAI_SERVER ?? config?.server;
  if (!value) throw new Error("No hay servidor configurado. Ejecuta modai connect <url>");
  const normalize = (url: string) => new URL(url).href.replace(/\/+$/, "");
  // Never forward a saved credential to a server selected by an unrelated repository.
  const savedToken = config && normalize(config.server) === normalize(value) ? config.token : undefined;
  return { server: value.replace(/\/+$/, ""), token: process.env.MODAI_API_TOKEN ?? savedToken };
}
