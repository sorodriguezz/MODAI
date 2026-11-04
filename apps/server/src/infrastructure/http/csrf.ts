import { AppError } from "@modai/contracts/errors";
import type { FastifyRequest } from "fastify";

export const CSRF_HEADER = "x-modai-csrf";

function sameOrigin(origin: string, request: FastifyRequest, publicUrl?: string): boolean {
  try {
    const source = new URL(origin);
    const target = request.headers.host ? new URL(`${source.protocol}//${request.headers.host}`) : undefined;
    return source.host === target?.host || source.origin === publicUrl;
  } catch {
    return false;
  }
}

// why: cookie writes need a custom header that cross-site forms cannot send, plus a same-origin Origin when present.
export function assertCsrf(request: FastifyRequest, publicUrl?: string): void {
  if (request.headers[CSRF_HEADER] !== "1")
    throw new AppError(
      403,
      "CSRF_REQUIRED",
      `Falta la cabecera ${CSRF_HEADER}. Recarga el panel e inténtalo de nuevo.`,
    );
  const origin = request.headers.origin;
  if (!origin || sameOrigin(origin, request, publicUrl)) return;
  throw new AppError(403, "CSRF_ORIGIN", "Origen de la solicitud no permitido");
}
