import { invariant } from "@modai/contracts/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { identityOf, sessionTokenOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import { mfaChangeBody, mfaConfirmBody, mfaSetupBody } from "./auth.schemas.js";
import { authRateLimit } from "./login-throttle.js";

function userSession(request: FastifyRequest, reply: FastifyReply) {
  reply.header("Cache-Control", "no-store");
  const user = identityOf(request);
  const session = sessionTokenOf(request);
  invariant(user, 401, "UNAUTHORIZED", "Inicia sesión para administrar tu cuenta");
  invariant(user.kind === "user" && session, 403, "USER_SESSION_REQUIRED", "Usa una sesión de usuario");
  return { user, session };
}

type WithFactor = { currentPassword: string; code: string };

export function mfaRoutes(app: FastifyInstance, { services, config }: ModuleOptions): void {
  const { mfa, audit } = services;
  const path = "/api/v1/auth/mfa";
  const rateLimit = authRateLimit(config.loginRateLimitMax);
  app.get(path, async (request, reply) => {
    const { user } = userSession(request, reply);
    return mfa.status(user.id);
  });
  app.post<{ Body: { currentPassword: string } }>(
    `${path}/setup`,
    { config: rateLimit, schema: { body: mfaSetupBody } },
    async (request, reply) => {
      const { user, session } = userSession(request, reply);
      return mfa.begin(user.id, session, request.body.currentPassword);
    },
  );
  app.post<{ Body: { setupToken: string; code: string } }>(
    `${path}/confirm`,
    { config: rateLimit, schema: { body: mfaConfirmBody } },
    async (request, reply) => {
      const { user, session } = userSession(request, reply);
      const { setupToken, code } = request.body;
      const result = await mfa.confirm(user.id, session, setupToken, code);
      await audit.fromRequest(request, "auth.mfa-enable", user.id);
      return result;
    },
  );
  app.post<{ Body: WithFactor }>(
    `${path}/recovery`,
    { config: rateLimit, schema: { body: mfaChangeBody } },
    async (request, reply) => {
      const { user, session } = userSession(request, reply);
      const { currentPassword, code } = request.body;
      const result = await mfa.replaceRecovery(user.id, session, currentPassword, code);
      await audit.fromRequest(request, "auth.mfa-recovery-rotate", user.id);
      return result;
    },
  );
  app.post<{ Body: WithFactor }>(
    `${path}/disable`,
    { config: rateLimit, schema: { body: mfaChangeBody } },
    async (request, reply) => {
      const { user, session } = userSession(request, reply);
      const { currentPassword, code } = request.body;
      await mfa.disable(user.id, session, currentPassword, code);
      await audit.fromRequest(request, "auth.mfa-disable", user.id);
      return { ok: true };
    },
  );
}
