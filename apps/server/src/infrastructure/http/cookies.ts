import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "modai_session";

export function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function secureCookie(request: FastifyRequest, publicUrl?: string): boolean {
  return request.protocol === "https" || Boolean(publicUrl?.startsWith("https:"));
}

export function setSessionCookie(
  reply: FastifyReply,
  request: FastifyRequest,
  token: string,
  maxAgeSeconds: number,
  publicUrl?: string,
): void {
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secureCookie(request, publicUrl) ? "; Secure" : ""}`,
  );
}

export function clearSessionCookie(reply: FastifyReply, request: FastifyRequest, publicUrl?: string): void {
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie(request, publicUrl) ? "; Secure" : ""}`,
  );
}
