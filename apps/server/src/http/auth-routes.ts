import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "@modai/contracts/errors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuditService } from "../core/audit-service.js";
import {
  type AuthService,
  type Identity,
  MIN_PASSWORD_LENGTH,
  ROLES,
  type Role,
  type UserRecord,
  type UserUpdate,
} from "../core/auth-service.js";

/**
 * Browser sessions for the admin panel. API keys (Bearer) keep working unchanged for CLI, MCP and workers;
 * a session cookie is only consulted when the request carries no Authorization header.
 */
export const SESSION_COOKIE = "modai_session";
export const CSRF_HEADER = "x-modai-csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type SessionRequest = FastifyRequest & { modaiIdentity?: Identity; modaiSessionToken?: string };

export interface AuthRouteOptions {
  auth: AuthService;
  audit: AuditService;
  publicUrl?: string;
  /** Requests per minute and IP allowed on login/setup (default 10). */
  loginRateLimitMax?: number;
  /** Base delay added to failed logins, in ms (default 400, plus jitter). */
  loginDelayMs?: number;
}

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

function setSessionCookie(
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

function clearSessionCookie(reply: FastifyReply, request: FastifyRequest, publicUrl?: string): void {
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie(request, publicUrl) ? "; Secure" : ""}`,
  );
}

/**
 * CSRF defence for cookie-authenticated writes: the cookie is SameSite=Strict, the request must carry a custom
 * header (which cross-site forms cannot set and CORS is disabled), and a present Origin must be this server.
 */
function assertCsrf(request: FastifyRequest, publicUrl?: string): void {
  if (request.headers[CSRF_HEADER] !== "1")
    throw new AppError(
      403,
      "CSRF_REQUIRED",
      `Falta la cabecera ${CSRF_HEADER}. Recarga el panel e inténtalo de nuevo.`,
    );
  const origin = request.headers.origin;
  if (!origin) return;
  let allowed = false;
  try {
    const source = new URL(origin);
    // Normalise default ports (Host "x:80" vs Origin "http://x").
    const target = request.headers.host ? new URL(`${source.protocol}//${request.headers.host}`) : undefined;
    allowed = source.host === target?.host || source.origin === publicUrl;
  } catch {
    allowed = false;
  }
  if (allowed) return;
  throw new AppError(403, "CSRF_ORIGIN", "Origen de la solicitud no permitido");
}

function publicIdentity(identity: Identity) {
  return {
    id: identity.id,
    label: identity.label,
    role: identity.role,
    kind: identity.kind ?? "api-key",
    projectIds: identity.projectIds,
    organizationIds: identity.organizationIds,
    packageScopes: identity.packageScopes,
  };
}

/** Registers the cookie → Identity hook. Must be added after the Bearer hook so Bearer keeps priority. */
export function registerSessionAuth(app: FastifyInstance, auth: AuthService, publicUrl?: string): void {
  app.addHook("onRequest", async (raw) => {
    const request = raw as SessionRequest;
    if (request.headers.authorization) return;
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return;
    const identity = auth.authenticateSession(token);
    if (!identity) return;
    request.modaiIdentity = identity;
    request.modaiSessionToken = token;
    if (!SAFE_METHODS.has(request.method)) assertCsrf(request, publicUrl);
  });
}

/** Seeds the first admin from options or MODAI_ADMIN_USERNAME / MODAI_ADMIN_PASSWORD (only when no user exists). */
export async function seedInitialAdmin(
  auth: AuthService,
  audit: AuditService,
  initial?: { username: string; password: string } | false,
): Promise<void> {
  const seed =
    initial === false
      ? undefined
      : (initial ??
        (process.env.MODAI_ADMIN_USERNAME?.trim()
          ? { username: process.env.MODAI_ADMIN_USERNAME, password: process.env.MODAI_ADMIN_PASSWORD ?? "" }
          : undefined));
  if (!seed || auth.userCount() > 0) return;
  try {
    const user = await auth.seedAdmin(seed.username, seed.password);
    if (user) audit.record("system", "user.seed", `user:${user.username}`, { role: user.role });
  } catch (error) {
    throw new Error(
      `No se pudo crear el administrador inicial (MODAI_ADMIN_USERNAME/MODAI_ADMIN_PASSWORD): ${(error as Error).message}`,
    );
  }
}

const grantProperties = {
  projectIds: { type: "array", maxItems: 200, items: { type: "string", minLength: 1, maxLength: 200 } },
  organizationIds: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 200 } },
  packageScopes: { type: "array", maxItems: 100, items: { type: "string", pattern: "^(\\*|@[a-z0-9][a-z0-9._-]*)$" } },
};
const roleProperty = { type: "string", enum: ROLES };
const passwordProperty = { type: "string", minLength: 1, maxLength: 1024 };

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { auth, audit, publicUrl } = options;
  const loginLimit = { rateLimit: { max: options.loginRateLimitMax ?? 10, timeWindow: "1 minute" } };
  const identityOf = (request: FastifyRequest) => (request as SessionRequest).modaiIdentity;
  const failDelay = () => delay((options.loginDelayMs ?? 400) + (options.loginDelayMs === 0 ? 0 : randomInt(0, 200)));
  const sessionMeta = (request: FastifyRequest) => ({ userAgent: request.headers["user-agent"], ip: request.ip });
  const requireManager = (request: FastifyRequest) => auth.requireManager(identityOf(request));
  /** Users outside the actor's organizations answer 404, as if they did not exist. */
  const managedUser = (actor: Identity, id: string): UserRecord => {
    const user = auth.getUser(id);
    if (!auth.canManageGrantee(actor, user)) throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado");
    return user;
  };

  app.get("/api/v1/auth/status", async (request) => {
    const identity = identityOf(request);
    return {
      setupRequired: auth.userCount() === 0,
      authenticated: Boolean(identity),
      identity: identity ? publicIdentity(identity) : null,
      user: identity?.kind === "user" ? auth.getUser(identity.id) : null,
      permissions: identity ? auth.permissions(identity) : null,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    };
  });

  app.post<{ Body: { bootstrapToken: string; username: string; displayName?: string; password: string } }>(
    "/api/v1/auth/setup",
    {
      config: loginLimit,
      schema: {
        body: {
          type: "object",
          required: ["bootstrapToken", "username", "password"],
          additionalProperties: false,
          properties: {
            bootstrapToken: { type: "string", minLength: 1, maxLength: 1024 },
            username: { type: "string", maxLength: 200 },
            displayName: { type: "string", maxLength: 200 },
            password: passwordProperty,
          },
        },
      },
    },
    async (request, reply) => {
      assertCsrf(request, publicUrl);
      if (auth.userCount() > 0)
        throw new AppError(409, "SETUP_COMPLETED", "El servidor ya tiene usuarios. Inicia sesión.");
      if (!auth.isBootstrapCredential(request.body.bootstrapToken)) {
        await failDelay();
        audit.record("anonymous", "auth.setup-failed", "server", { ip: request.ip });
        throw new AppError(
          401,
          "INVALID_BOOTSTRAP_TOKEN",
          "El token de instalación no es válido. Usa el valor de MODAI_API_TOKEN del servidor.",
        );
      }
      const user = await auth.createFirstAdmin({
        username: request.body.username,
        displayName: request.body.displayName,
        password: request.body.password,
      });
      const session = auth.createSession(user.id, sessionMeta(request));
      setSessionCookie(reply, request, session.token, session.maxAgeSeconds, publicUrl);
      audit.record(user.username, "auth.setup", `user:${user.username}`, { ip: request.ip });
      return reply.code(201).send({ user });
    },
  );

  app.post<{ Body: { username: string; password: string } }>(
    "/api/v1/auth/login",
    {
      config: loginLimit,
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          additionalProperties: false,
          properties: { username: { type: "string", maxLength: 200 }, password: passwordProperty },
        },
      },
    },
    async (request, reply) => {
      assertCsrf(request, publicUrl);
      const attempted = String(request.body.username ?? "")
        .trim()
        .toLowerCase()
        .slice(0, 64);
      const result = await auth.verifyLogin(request.body.username, request.body.password, request.ip);
      if (!result.user) {
        await failDelay();
        audit.record(attempted || "anonymous", "auth.login-failed", `user:${attempted}`, {
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
      if (previous) auth.deleteSession(previous);
      const session = auth.createSession(result.user.id, sessionMeta(request));
      setSessionCookie(reply, request, session.token, session.maxAgeSeconds, publicUrl);
      audit.record(result.user.username, "auth.login", `user:${result.user.username}`, { ip: request.ip });
      return { user: auth.getUser(result.user.id), expiresAt: session.expiresAt };
    },
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const raw = request as SessionRequest;
    const token = raw.modaiSessionToken ?? readCookie(request, SESSION_COOKIE);
    if (token) auth.deleteSession(token);
    if (raw.modaiSessionToken)
      audit.record(raw.modaiIdentity!.label, "auth.logout", `user:${raw.modaiIdentity!.label}`);
    clearSessionCookie(reply, request, publicUrl);
    return reply.code(204).send();
  });

  app.get("/api/v1/auth/me", async (request) => {
    const identity = auth.require(identityOf(request), "reader");
    return {
      identity: publicIdentity(identity),
      user: identity.kind === "user" ? auth.getUser(identity.id) : null,
      permissions: auth.permissions(identity),
    };
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/api/v1/auth/password",
    {
      config: loginLimit,
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          additionalProperties: false,
          properties: { currentPassword: passwordProperty, newPassword: passwordProperty },
        },
      },
    },
    async (request) => {
      const identity = auth.require(identityOf(request), "reader");
      if (identity.kind !== "user")
        throw new AppError(
          400,
          "NOT_A_USER",
          "Solo las cuentas de usuario tienen contraseña; las API keys se revocan y se crean de nuevo.",
        );
      await auth.changeOwnPassword(
        identity.id,
        request.body.currentPassword,
        request.body.newPassword,
        (request as SessionRequest).modaiSessionToken,
      );
      audit.record(identity.label, "auth.password-change", `user:${identity.label}`, { ip: request.ip });
      return { ok: true };
    },
  );

  app.get("/api/v1/admin/users", async (request) => {
    const actor = requireManager(request);
    return { users: auth.listUsers().filter((user) => auth.canManageGrantee(actor, user)) };
  });

  app.post<{
    Body: {
      username: string;
      displayName?: string;
      password: string;
      role: Role;
      projectIds?: string[];
      organizationIds?: string[];
      packageScopes?: string[];
    };
  }>(
    "/api/v1/admin/users",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password", "role"],
          additionalProperties: false,
          properties: {
            username: { type: "string", maxLength: 200 },
            displayName: { type: "string", maxLength: 200 },
            password: passwordProperty,
            role: roleProperty,
            ...grantProperties,
          },
        },
      },
    },
    async (request, reply) => {
      const actor = requireManager(request);
      auth.assertGrants(actor, request.body.role, request.body);
      const user = await auth.createUser(request.body);
      audit.record(identityOf(request)!.label, "user.create", `user:${user.username}`, { role: user.role });
      return reply.code(201).send({ user });
    },
  );

  app.patch<{ Params: { id: string }; Body: UserUpdate }>(
    "/api/v1/admin/users/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            displayName: { type: "string", minLength: 1, maxLength: 200 },
            role: roleProperty,
            disabled: { type: "boolean" },
            password: passwordProperty,
            ...grantProperties,
          },
        },
      },
    },
    async (request) => {
      const actor = requireManager(request);
      const current = managedUser(actor, request.params.id);
      const body = request.body ?? {};
      if (
        body.role !== undefined ||
        body.projectIds !== undefined ||
        body.organizationIds !== undefined ||
        body.packageScopes !== undefined
      ) {
        auth.assertGrants(actor, body.role ?? current.role, {
          projectIds: body.projectIds ?? current.projectIds,
          organizationIds: body.organizationIds ?? current.organizationIds,
          packageScopes: body.packageScopes ?? current.packageScopes,
        });
      }
      const user: UserRecord = await auth.updateUser(actor, request.params.id, body);
      const { password, ...changes } = request.body ?? {};
      audit.record(actor.label, "user.update", `user:${user.username}`, {
        ...changes,
        ...(password !== undefined ? { passwordReset: true } : {}),
      });
      return { user };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/v1/admin/users/:id", async (request, reply) => {
    const actor = requireManager(request);
    managedUser(actor, request.params.id);
    const user = auth.deleteUser(actor, request.params.id);
    audit.record(actor.label, "user.delete", `user:${user.username}`);
    return reply.code(204).send();
  });
}
