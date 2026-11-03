// Este módulo se usa exclusivamente desde CLI/MCP en el equipo cliente.
export interface LocalModel {
  name: string;
  digest: string;
  size?: number;
  remote_host?: string;
  remote_model?: string;
}

function assertLocalModelName(name: string): void {
  if (!name.trim() || /cloud/i.test(name) || /https?:\/\//i.test(name))
    throw new Error("Selecciona un modelo descargable local, no un modelo cloud.");
}

export function localRuntimeUrl(value = "http://127.0.0.1:11434"): string {
  const url = new URL(value);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "El runtime debe ser local: http://127.0.0.1:11434, http://localhost:PUERTO o http://[::1]:PUERTO.",
    );
  }
  return url.origin;
}

export class LocalOllama {
  readonly url: string;
  constructor(url?: string) {
    this.url = localRuntimeUrl(url);
  }

  private async request<T>(path: string, body?: unknown, timeout = 120_000): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url + path, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new Error(
        `No responde Ollama local en ${this.url}. Instala/inicia el runtime en este cliente: https://ollama.com/download`,
      );
    }
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok || data.error)
      throw new Error(
        `Ollama local: ${data.error ?? response.statusText}. Comprueba versión, memoria y modelo instalado.`,
      );
    return data;
  }

  async status() {
    const [version, tags, running] = await Promise.all([
      this.request<{ version: string }>("/api/version", undefined, 4000),
      this.request<{ models: LocalModel[] }>("/api/tags", undefined, 4000),
      this.request<{ models: Array<{ name: string; size: number; size_vram: number }> }>("/api/ps", undefined, 4000),
    ]);
    return { url: this.url, version: version.version, models: tags.models, running: running.models };
  }

  async model(name: string): Promise<LocalModel> {
    assertLocalModelName(name);
    const { models } = await this.request<{ models: LocalModel[] }>("/api/tags", undefined, 4000);
    const found = models.find((m) => m.name === name || m.name === `${name}:latest`);
    if (!found?.digest)
      throw new Error(
        `El modelo ${name} no está instalado. Ejecuta modai client setup --embedding-model ${name} --download.`,
      );
    if (found.remote_host || found.remote_model)
      throw new Error("El modelo es un alias remoto. Selecciona pesos locales para los embeddings.");
    return found;
  }

  async pull(model: string, progress?: (message: string) => void): Promise<void> {
    assertLocalModelName(model);
    // Streaming mantiene visible el progreso de descargas largas sin buffering completo.
    const response = await fetch(this.url + "/api/pull", {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal: AbortSignal.timeout(30 * 60_000),
    });
    if (!response.ok || !response.body)
      throw new Error(
        `No se pudo descargar ${model}: HTTP ${response.status}. Actualiza Ollama o elige --embedding-model embeddinggemma:300m.`,
      );
    let pending = "",
      last = "";
    const handle = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as { error?: string; status?: string; total?: number; completed?: number };
      if (event.error) throw new Error(event.error);
      const label = `${event.status ?? "descargando"}${event.total ? ` ${Math.floor((100 * (event.completed ?? 0)) / event.total)}%` : ""}`;
      if (label !== last) {
        progress?.(label);
        last = label;
      }
    };
    for await (const part of response.body.pipeThrough(new TextDecoderStream())) {
      pending += part;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      lines.forEach(handle);
    }
    handle(pending);
    await this.model(model);
  }

  async embed(model: string, texts: string[]): Promise<number[][]> {
    assertLocalModelName(model);
    const data = await this.request<{ embeddings: number[][] }>("/api/embed", {
      model,
      input: texts,
      truncate: false,
      keep_alive: "1m",
    });
    if (
      data.embeddings?.length !== texts.length ||
      data.embeddings.some(
        (v) =>
          !Array.isArray(v) ||
          !v.length ||
          v.length > 8192 ||
          v.some((x) => !Number.isFinite(x)) ||
          !v.some((x) => x !== 0),
      ) ||
      data.embeddings.some((v) => v.length !== data.embeddings[0].length)
    )
      throw new Error("El runtime devolvió embeddings inválidos.");
    return data.embeddings;
  }
}
