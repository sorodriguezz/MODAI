import { AppError } from "@modai/contracts/errors";
import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";
import { createUserBody, updateUserBody } from "./auth.schemas.js";
import { assertGrants } from "./grant-policy.js";
import type { Identity, Role, UserRecord, UserUpdate } from "./identity.js";

type CreateUserBody = {
  username: string;
  displayName?: string;
  password: string;
  role: Role;
  projectIds?: string[];
  organizationIds?: string[];
  packageScopes?: string[];
};

const changesGrants = (body: UserUpdate) =>
  body.role !== undefined ||
  body.projectIds !== undefined ||
  body.organizationIds !== undefined ||
  body.packageScopes !== undefined;

export async function usersRoutes(app: FastifyInstance, { services }: ModuleOptions): Promise<void> {
  const { authz, users, audit } = services;
  const managedUser = async (actor: Identity, id: string): Promise<UserRecord> => {
    const user = await users.getUser(id);
    if (!authz.canManageGrantee(actor, user)) throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado");
    return user;
  };

  app.get("/api/v1/admin/users", async (request) => {
    const actor = authz.requireManager(identityOf(request));
    return { users: (await users.listUsers()).filter((user) => authz.canManageGrantee(actor, user)) };
  });

  app.post<{ Body: CreateUserBody }>(
    "/api/v1/admin/users",
    { schema: { body: createUserBody } },
    async (request, reply) => {
      const actor = authz.requireManager(identityOf(request));
      await assertGrants(authz, actor, request.body.role, request.body);
      const user = await users.createUser(request.body);
      await audit.record(actor.label, "user.create", `user:${user.username}`, { role: user.role });
      return reply.code(201).send({ user });
    },
  );

  app.patch<{ Params: { id: string }; Body: UserUpdate }>(
    "/api/v1/admin/users/:id",
    { schema: { body: updateUserBody } },
    async (request) => {
      const actor = authz.requireManager(identityOf(request));
      const current = await managedUser(actor, request.params.id);
      const body = request.body ?? {};
      if (changesGrants(body))
        await assertGrants(authz, actor, body.role ?? current.role, {
          projectIds: body.projectIds ?? current.projectIds,
          organizationIds: body.organizationIds ?? current.organizationIds,
          packageScopes: body.packageScopes ?? current.packageScopes,
        });
      const user = await users.updateUser(actor, request.params.id, body);
      const { password, ...changes } = body;
      await audit.record(actor.label, "user.update", `user:${user.username}`, {
        ...changes,
        ...(password !== undefined ? { passwordReset: true } : {}),
      });
      return { user };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/v1/admin/users/:id", async (request, reply) => {
    const actor = authz.requireManager(identityOf(request));
    await managedUser(actor, request.params.id);
    const user = await users.deleteUser(actor, request.params.id);
    await audit.record(actor.label, "user.delete", `user:${user.username}`);
    return reply.code(204).send();
  });
}
