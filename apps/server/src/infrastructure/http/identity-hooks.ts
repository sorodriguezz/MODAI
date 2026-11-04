import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Identity } from "../../modules/auth/identity.js";
import { readCookie, SESSION_COOKIE } from "./cookies.js";
import { assertCsrf } from "./csrf.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type IdentityRequest = FastifyRequest & { modaiIdentity?: Identity; modaiSessionToken?: string };

export interface IdentityResolvers {
  bearer(token: string | undefined): Promise<Identity | undefined>;
  session(token: string): Promise<Identity | undefined>;
  publicUrl?: string;
}

export const identityOf = (request: FastifyRequest): Identity | undefined => (request as IdentityRequest).modaiIdentity;

export const sessionTokenOf = (request: FastifyRequest): string | undefined =>
  (request as IdentityRequest).modaiSessionToken;

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
}

// why: the Bearer hook runs first so API keys keep priority; the cookie is only read without an Authorization header.
export function registerIdentityHooks(app: FastifyInstance, resolvers: IdentityResolvers): void {
  app.addHook("onRequest", async (raw) => {
    (raw as IdentityRequest).modaiIdentity = await resolvers.bearer(bearerToken(raw));
  });
  app.addHook("onRequest", async (raw) => {
    const request = raw as IdentityRequest;
    if (request.headers.authorization) return;
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return;
    const identity = await resolvers.session(token);
    if (!identity) return;
    request.modaiIdentity = identity;
    request.modaiSessionToken = token;
    if (!SAFE_METHODS.has(request.method)) assertCsrf(request, resolvers.publicUrl);
  });
}
