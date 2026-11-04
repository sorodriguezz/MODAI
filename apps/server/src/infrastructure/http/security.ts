import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";

export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  frameAncestors: ["'none'"],
  upgradeInsecureRequests: null,
};

export async function registerSecurity(app: FastifyInstance, options: { rateLimitMax?: number }): Promise<void> {
  await app.register(cors, { origin: false });
  await app.register(helmet, {
    contentSecurityPolicy: { directives: CONTENT_SECURITY_POLICY },
    frameguard: { action: "deny" },
  });
  await app.register(rateLimit, { max: options.rateLimitMax ?? 600, timeWindow: "1 minute" });
}

export function parsePublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("MODAI_PUBLIC_URL debe ser un origen HTTP(S), sin ruta ni credenciales");
  return url.origin;
}
