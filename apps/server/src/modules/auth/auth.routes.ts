import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "@modai/contracts/errors";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { clearSessionCookie, readCookie, SESSION_COOKIE, setSessionCookie } from "../../infrastructure/http/cookies.js";
import { assertCsrf } from "../../infrastructure/http/csrf.js";
import { identityOf, sessionTokenOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import { loginBody, passwordBody, setupBody } from "./auth.schemas.js";
import { type Identity, MIN_PASSWORD_LENGTH } from "./identity.js";
import { permissionsOf } from "./permissions.js";

const publicIdentity = (identity: Identity) => ({
  id: identity.id,
  label: identity.label,
  role: identity.role,
  kind: identity.kind ?? "api-key",
  projectIds: identity.projectIds,
  organizationIds: identity.organizationIds,
  packageScopes: identity.packageScopes,
});

const sessionMeta = (request: FastifyRequest) => ({ userAgent: request.headers["user-agent"], ip: request.ip });

const loginLimit = (options: ModuleOptions) => ({
  rateLimit: { max: options.config.loginRateLimitMax ?? 10, timeWindow: "1 minute" },
});

const failDelay = (options: ModuleOptions) => {
  const base = options.config.loginDelayMs;
  return delay((base ?? 400) + (base === 0 ? 0 : randomInt(0, 200)));
};

function statusRoutes(app: FastifyInstance, { services }: ModuleOptions): void {
  const { authz, users } = services;
  const userOf = (identity?: Identity) => (identity?.kind === "user" ? users.getUser(identity.id) : null);
  app.get("/api/v1/auth/status", async (request) => {
    const identity = identityOf(request);
    return {
      setupRequired: (await users.userCount()) === 0,
      authenticated: Boolean(identity),
      identity: identity ? publicIdentity(identity) : null,
      user: await userOf(identity),
      permissions: identity ? await permissionsOf(authz, identity) : null,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    };
  });
  app.get("/api/v1/auth/me", async (request) => {
    const identity = authz.require(identityOf(request), "reader");
    return {
      identity: publicIdentity(identity),
      user: await userOf(identity),
      permissions: await permissionsOf(authz, identity),
    };
  });
  app.get("/api/v1/session", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const identity = authz.require(identityOf(request), "reader");
    return {
      label: identity.label,
      role: identity.role,
      projectIds: identity.projectIds,
      organizationIds: identity.organizationIds,
      packageScopes: identity.packageScopes,
      permissions: await permissionsOf(authz, identity),
    };
  });
}

function setupRoute(app: FastifyInstance, options: ModuleOptions): void {
  const { users, sessions, apiKeys, audit } = options.services;
  const publicUrl = options.config.publicUrl;
  app.post<{ Body: { bootstrapToken: string; username: string; displayName?: string; password: string } }>(
    "/api/v1/auth/setup",
    { config: loginLimit(options), schema: { body: setupBody } },
    async (request, reply) => {
      assertCsrf(request, publicUrl);
      if ((await users.userCount()) > 0)
        throw new AppError(409, "SETUP_COMPLETED", "El servidor ya tiene usuarios. Inicia sesión.");
      if (!(await apiKeys.isBootstrapCredential(request.body.bootstrapToken))) {
        await failDelay(options);
        await audit.record("anonymous", "auth.setup-failed", "server", { ip: request.ip });
        throw new AppError(
          401,
          "INVALID_BOOTSTRAP_TOKEN",
          "El token de instalación no es válido. Usa el valor de MODAI_API_TOKEN del servidor.",
        );
      }
      const { username, displayName, password } = request.body;
      const user = await users.createFirstAdmin({ username, displayName, password });
      const session = await sessions.create(user.id, sessionMeta(request));
      setSessionCookie(reply, request, session.token, session.maxAgeSeconds, publicUrl);
      await audit.record(user.username, "auth.setup", `user:${user.username}`, { ip: request.ip });
      return reply.code(201).send({ user });
    },
  );
}

function loginRoute(app: FastifyInstance, options: ModuleOptions): void {
  const { users, sessions, audit } = options.services;
  const publicUrl = options.config.publicUrl;
  app.post<{ Body: { username: string; password: string } }>(
    "/api/v1/auth/login",
    { config: loginLimit(options), schema: { body: loginBody } },
    async (request, reply) => {
      assertCsrf(request, publicUrl);
      const attempted = String(request.body.username ?? "")
        .trim()
        .toLowerCase()
        .slice(0, 64);
      const result = await users.verifyLogin(request.body.username, request.body.password, request.ip);
      if (!result.user) {
        await failDelay(options);
        await audit.record(attempted || "anonymous", "auth.login-failed", `user:${attempted}`, {
          ip: request.ip,
          locked: result.locked,
        });
        if (result.locked)
          throw new AppError(
            429,
            "LOGIN_LOCKED",
            "Demasiados intentos fallidos. Espera unos minutos antes de volver a intentarlo.",
          );
        throw new AppError(401, "INVALID_CREDENTIALS", "Usuario o contraseña incorrectos");
      }
      const previous = readCookie(request, SESSION_COOKIE);
      if (previous) await sessions.delete(previous);
      const session = await sessions.create(result.user.id, sessionMeta(request));
      setSessionCookie(reply, request, session.token, session.maxAgeSeconds, publicUrl);
      await audit.record(result.user.username, "auth.login", `user:${result.user.username}`, { ip: request.ip });
      return { user: await users.getUser(result.user.id), expiresAt: session.expiresAt };
    },
  );
}

function accountRoutes(app: FastifyInstance, options: ModuleOptions): void {
  const { authz, users, sessions, audit } = options.services;
  app.post("/api/v1/auth/logout", async (request, reply) => {
    const sessionToken = sessionTokenOf(request);
    const token = sessionToken ?? readCookie(request, SESSION_COOKIE);
    if (token) await sessions.delete(token);
    if (sessionToken) {
      const label = identityOf(request)!.label;
      await audit.record(label, "auth.logout", `user:${label}`);
    }
    clearSessionCookie(reply, request, options.config.publicUrl);
    return reply.code(204).send();
  });
  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/api/v1/auth/password",
    { config: loginLimit(options), schema: { body: passwordBody } },
    async (request) => {
      const identity = authz.require(identityOf(request), "reader");
      if (identity.kind !== "user")
        throw new AppError(
          400,
          "NOT_A_USER",
          "Solo las cuentas de usuario tienen contraseña; las API keys se revocan y se crean de nuevo.",
        );
      const { currentPassword, newPassword } = request.body;
      await users.changeOwnPassword(identity.id, currentPassword, newPassword, sessionTokenOf(request));
      await audit.record(identity.label, "auth.password-change", `user:${identity.label}`, { ip: request.ip });
      return { ok: true };
    },
  );
}

export async function authRoutes(app: FastifyInstance, options: ModuleOptions): Promise<void> {
  statusRoutes(app, options);
  setupRoute(app, options);
  loginRoute(app, options);
  accountRoutes(app, options);
}
