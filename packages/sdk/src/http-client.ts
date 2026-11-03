export class HttpClient {
  protected readonly baseUrl: string;

  constructor(
    server: string,
    private readonly token?: string,
  ) {
    const url = new URL(server);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error("URL de MODAI inválida");
    this.baseUrl = server.replace(/\/+$/, "");
  }

  protected async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        ...init,
        headers: {
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new Error(`No se pudo conectar con ${this.baseUrl}: ${(error as Error).message}`);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new Error(
        `${body.error?.code ?? `HTTP_${response.status}`}: ${body.error?.message ?? response.statusText}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
