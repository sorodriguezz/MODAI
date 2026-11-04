import { ApiClient } from "@modai/sdk";
import type { Command } from "commander";
import { clientConfigPath, loadClientConfig, saveClientConfig } from "../../services/config.js";
import { effectiveConnection, insecureTransport } from "../../services/connection.js";
import { readAccessToken } from "../../services/credentials.js";
import type { Print } from "../../terminal/output.js";
import { askText, interactive, ok } from "../../terminal/prompts.js";
import { shellQuote } from "../../terminal/shell.js";

type ConnectOptions = { token?: string; tokenStdin?: boolean };

const validUrl = (value: string) => {
  try {
    return /^https?:$/.test(new URL(value).protocol) || "Usa una URL http(s)";
  } catch {
    return "No es una URL válida";
  }
};

async function askServerUrl(): Promise<string> {
  return askText({
    message: "URL del servidor MODAI",
    flag: "la URL (modai server connect <url>)",
    example: "https://modai.miempresa.com",
    ...(interactive()
      ? { default: process.env.MODAI_SERVER || loadClientConfig()?.server || "http://localhost:8787" }
      : {}),
    validate: validUrl,
  });
}

async function tokenForConnect(target: string, options: ConnectOptions): Promise<string> {
  if (options.token) return options.token;
  if (options.tokenStdin) return readAccessToken(true);
  return effectiveConnection(target).token ?? (await readAccessToken());
}

export function registerServerConnect(server: Command, print: Print): void {
  server
    .command("connect")
    .description("Conecta la CLI a un servidor MODAI")
    .argument("[url]", "URL del servidor (sin ella, se pregunta)")
    .option("--token <token>", "Token Bearer (prefiere la entrada oculta o --token-stdin)")
    .option("--token-stdin", "Lee la API key por stdin para automatizaciones")
    .action(async (url: string | undefined, options: ConnectOptions) => {
      const target = (url ?? (await askServerUrl())).replace(/\/+$/, "");
      if (options.token && options.tokenStdin) throw new Error("Usa --token o --token-stdin, no ambos");
      if (insecureTransport(target))
        throw new Error(
          `${target} usa http: la API key viajaría sin cifrar. Usa https (o MODAI_ALLOW_INSECURE_HTTP=1 si es una red de confianza).`,
        );
      const token = await tokenForConnect(target, options);
      const api = new ApiClient(target, token);
      await api.assertCompatible();
      const health = await api.health();
      const identity = await api.session();
      const projects = await api.projects();
      saveClientConfig({ ...loadClientConfig(), server: target, token });
      print(
        ok(
          `Conectado a ${target} (MODAI ${health.version}) como ${identity.label} · ${identity.role}. Configuración: ${clientConfigPath}`,
        ),
      );
      print(
        projects.length
          ? projects.map((project) => `${project.name}: modai init --project ${shellQuote(project.id)}`).join("\n")
          : "No hay proyectos asignados. Pide acceso a quien administra el servidor.",
      );
    });
}
