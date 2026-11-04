import { AppError } from "@modai/contracts/errors";
import { keySchema, parseInput } from "@modai/contracts/schemas";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import type { Services } from "../services.js";
import { assertGrants } from "./grant-policy.js";
import type { Identity, KeyGrants, Role, UserRecord } from "./identity.js";
import { assertKeyWithinOwner } from "./key-policy.js";

const ownerOf = (actor: Identity): string | undefined => (actor.kind === "user" ? actor.id : actor.ownerId);

async function createOwnedKey(
  services: Services,
  actor: Identity,
  owner: UserRecord,
  input: { label: string; role: Role; inherit?: boolean } & KeyGrants,
) {
  const inherit =
    input.inherit ?? !(input.projectIds?.length || input.organizationIds?.length || input.packageScopes?.length);
  await assertKeyWithinOwner(services.authz, owner, input.role, input, inherit);
  const key = await services.apiKeys.createKey(input.label, input.role, inherit ? {} : input, {
    ownerId: owner.id,
    inherit,
  });
  await services.audit.record(actor.label, "api-key.create", key.id, {
    label: key.label,
    role: key.role,
    owner: owner.username,
    inherit,
  });
  return key;
}

async function manageableOwner(services: Services, actor: Identity, ownerId: string): Promise<UserRecord> {
  const owner = await services.users.getUser(ownerId);
  if (!services.authz.canManageGrantee(actor, owner) && owner.id !== ownerOf(actor))
    throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado");
  return owner;
}

function ownKeyRoutes(app: FastifyInstance, services: Services): void {
  const { authz, apiKeys, users, audit } = services;
  app.get("/api/v1/me/api-keys", async (request) => {
    const owner = ownerOf(authz.require(identityOf(request), "reader"));
    if (!owner) throw new AppError(400, "NO_OWNER", "Esta credencial no pertenece a un usuario");
    return { keys: await apiKeys.listKeys(owner) };
  });
  app.post("/api/v1/me/api-keys", async (request, reply) => {
    const actor = authz.require(identityOf(request), "reader");
    if (actor.kind !== "user")
      throw new AppError(403, "SESSION_REQUIRED", "Crea API keys desde el panel con tu usuario");
    const input = parseInput(keySchema.omit({ ownerId: true }), request.body);
    return reply.code(201).send({ key: await createOwnedKey(services, actor, await users.getUser(actor.id), input) });
  });
  app.delete<{ Params: { id: string } }>("/api/v1/me/api-keys/:id", async (request, reply) => {
    const actor = authz.require(identityOf(request), "reader");
    const key = await apiKeys.getKey(request.params.id);
    if (!key.ownerId || key.ownerId !== ownerOf(actor))
      throw new AppError(404, "API_KEY_NOT_FOUND", "Clave no encontrada");
    await apiKeys.revokeKey(key.id);
    await audit.fromRequest(request, "api-key.revoke", key.id, { owner: key.ownerName });
    return reply.code(204).send();
  });
}

function adminKeyRoutes(app: FastifyInstance, services: Services): void {
  const { authz, apiKeys, audit } = services;
  app.get<{ Querystring: { ownerId?: string } }>("/api/v1/admin/api-keys", async (request) => {
    const actor = authz.requireManager(identityOf(request));
    const keys = [];
    for (const key of await apiKeys.listKeys(request.query.ownerId || undefined))
      if (await apiKeys.canManageKey(actor, key)) keys.push(key);
    return { keys };
  });
  app.post("/api/v1/admin/api-keys", async (request, reply) => {
    const actor = authz.requireManager(identityOf(request));
    const input = parseInput(keySchema, request.body);
    const ownerId = input.ownerId === undefined ? ownerOf(actor) : (input.ownerId ?? undefined);
    if (ownerId) {
      const owner = await manageableOwner(services, actor, ownerId);
      return reply.code(201).send({ key: await createOwnedKey(services, actor, owner, input) });
    }
    if (actor.role !== "admin") throw new AppError(400, "OWNER_REQUIRED", "Elige el usuario dueño de la API key");
    await assertGrants(authz, actor, input.role, input);
    const key = await apiKeys.createKey(input.label, input.role, input);
    await audit.fromRequest(request, "api-key.create", key.id, { label: key.label, role: key.role });
    return reply.code(201).send({ key });
  });
  app.delete<{ Params: { id: string } }>("/api/v1/admin/api-keys/:id", async (request, reply) => {
    const actor = authz.requireManager(identityOf(request));
    if (!(await apiKeys.canManageKey(actor, await apiKeys.getKey(request.params.id))))
      throw new AppError(404, "API_KEY_NOT_FOUND", "Clave no encontrada");
    await apiKeys.revokeKey(request.params.id);
    await audit.fromRequest(request, "api-key.revoke", request.params.id);
    return reply.code(204).send();
  });
}

function keyGrantsRoute(app: FastifyInstance, services: Services): void {
  const { authz, apiKeys, audit } = services;
  app.patch<{ Params: { id: string } }>("/api/v1/admin/api-keys/:id", async (request) => {
    const actor = authz.requireManager(identityOf(request));
    const input = parseInput(
      keySchema.pick({ projectIds: true, organizationIds: true, packageScopes: true, ownerId: true, inherit: true }),
      request.body,
    );
    const current = await apiKeys.getKey(request.params.id);
    if (!(await apiKeys.canManageKey(actor, current)))
      throw new AppError(404, "API_KEY_NOT_FOUND", "Clave no encontrada");
    const ownerId = input.ownerId === undefined ? current.ownerId : (input.ownerId ?? undefined);
    if (current.ownerId && !ownerId)
      throw new AppError(400, "OWNER_REQUIRED", "Una API key con dueño no puede quedar sin dueño");
    const inherit = input.inherit ?? current.inherit;
    if (ownerId)
      await assertKeyWithinOwner(authz, await manageableOwner(services, actor, ownerId), current.role, input, inherit);
    else await assertGrants(authz, actor, current.role, input);
    await apiKeys.updateKeyGrants(request.params.id, inherit ? {} : input, { ownerId: ownerId ?? null, inherit });
    await audit.fromRequest(request, "api-key.grants", request.params.id, { ...input, inherit });
    return { key: await apiKeys.getKey(request.params.id) };
  });
}

export async function apiKeysRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  ownKeyRoutes(app, services);
  adminKeyRoutes(app, services);
  keyGrantsRoute(app, services);
}
