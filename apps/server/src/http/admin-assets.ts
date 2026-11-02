import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const defaultAdminDirectory = fileURLToPath(
  new URL("../../../admin/dist/", import.meta.url),
);

/** The API serves the independently built panel on the same origin; no frontend server or CORS setup is needed. */
export function registerAdminAssets(
  app: FastifyInstance,
  directory = defaultAdminDirectory,
): void {
  const files = new Map<string, { path: string; type: string }>();
  for (const [name, type] of Object.entries({
    "index.html": "text/html; charset=utf-8",
    "styles.css": "text/css; charset=utf-8",
    "main.js": "text/javascript; charset=utf-8",
    "theme.js": "text/javascript; charset=utf-8",
    "favicon.svg": "image/svg+xml",
  })) {
    try {
      readFileSync(join(directory, name));
      files.set(name, { path: join(directory, name), type });
    } catch {
      throw new Error(
        `Falta el panel compilado en ${directory}. Ejecuta npm run build -w @modai/admin.`,
      );
    }
  }
  const index = files.get("index.html")!;
  for (const route of ["/admin", "/admin/"])
    app.get(route, async (_request, reply) =>
      reply
        .header("cache-control", "no-cache")
        .type(index.type)
        .send(readFileSync(index.path)),
    );
  app.get<{ Params: { "*": string } }>(
    "/admin/assets/*",
    async (request, reply) => {
      const file = files.get(request.params["*"]);
      if (!file || request.params["*"] === "index.html")
        return reply
          .code(404)
          .send({
            error: { code: "NOT_FOUND", message: "Archivo no encontrado" },
          });
      return reply
        .header("cache-control", "no-cache")
        .type(file.type)
        .send(readFileSync(file.path));
    },
  );
}
