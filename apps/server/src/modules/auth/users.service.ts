import { randomUUID } from "node:crypto";
import { AppError, invariant } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import { isUniqueViolation } from "../../infrastructure/database/sql-helpers.js";
import { NamespacesRepository } from "../namespaces/namespaces.repository.js";
import {
  type Identity,
  MAX_PASSWORD_LENGTH,
  personalNamespace,
  ROLES,
  type UserInput,
  type UserRecord,
  type UserUpdate,
} from "./identity.js";
import { LoginThrottle } from "./login-throttle.js";
import { assertPassword, decoyPasswordHash, hashPassword, normalizeUsername, verifyPassword } from "./passwords.js";
import { SessionsRepository } from "./sessions.repository.js";
import { assertUserUpdateAllowed, userChanges } from "./user-changes.js";
import { toUser, UsersRepository } from "./users.repository.js";

const SETUP_DONE = "El servidor ya tiene usuarios. Inicia sesión.";

export class UsersService {
  private readonly users: UsersRepository;
  private readonly sessions: SessionsRepository;
  private readonly throttle = new LoginThrottle();

  constructor(private readonly context: DataContext) {
    this.users = new UsersRepository(context);
    this.sessions = new SessionsRepository(context);
  }

  userCount(): Promise<number> {
    return this.users.count();
  }

  activeAdminCount(): Promise<number> {
    return this.users.activeAdminCount();
  }

  async listUsers(): Promise<UserRecord[]> {
    return (await this.users.list()).map(toUser);
  }

  async getUser(id: string): Promise<UserRecord> {
    const row = await this.users.findById(id);
    if (!row) throw new AppError(404, "USER_NOT_FOUND", "Usuario no encontrado");
    return toUser(row);
  }

  async createUser(input: UserInput): Promise<UserRecord> {
    const username = normalizeUsername(input.username);
    invariant(ROLES.includes(input.role), 400, "INVALID_ROLE", "Rol inválido");
    assertPassword(input.password, username);
    const displayName = (input.displayName ?? "").trim().slice(0, 200) || username;
    await this.assertNamespaceFree(username);
    const id = randomUUID(),
      hash = await hashPassword(input.password),
      now = new Date().toISOString();
    try {
      await this.users.insert({
        id,
        username,
        display_name: displayName,
        password_hash: hash,
        role: input.role,
        project_ids_json: JSON.stringify(input.projectIds ?? []),
        organization_ids_json: JSON.stringify(input.organizationIds ?? []),
        package_scopes_json: JSON.stringify(input.packageScopes ?? []),
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, "USERNAME_TAKEN", "Ese nombre de usuario ya existe");
      throw error;
    }
    return this.getUser(id);
  }

  async createFirstAdmin(input: Omit<UserInput, "role">): Promise<UserRecord> {
    invariant((await this.userCount()) === 0, 409, "SETUP_COMPLETED", SETUP_DONE);
    const username = normalizeUsername(input.username);
    assertPassword(input.password, username);
    await this.assertNamespaceFree(username);
    const id = randomUUID(),
      hash = await hashPassword(input.password),
      now = new Date().toISOString();
    const inserted = await withTransaction(this.context, async (trx) => {
      if ((await this.users.count(trx)) > 0) return false;
      const displayName = (input.displayName ?? "").trim().slice(0, 200) || username;
      await this.users.insert(
        {
          id,
          username,
          display_name: displayName,
          password_hash: hash,
          role: "admin",
          project_ids_json: "[]",
          organization_ids_json: "[]",
          package_scopes_json: "[]",
          created_at: now,
          updated_at: now,
        },
        trx,
      );
      return true;
    });
    invariant(inserted, 409, "SETUP_COMPLETED", SETUP_DONE);
    return this.getUser(id);
  }

  async seedAdmin(username?: string, password?: string): Promise<UserRecord | undefined> {
    if (!username?.trim() || !password || (await this.userCount()) > 0) return undefined;
    return this.createFirstAdmin({ username, password, displayName: username });
  }

  async updateUser(actor: Identity, id: string, input: UserUpdate): Promise<UserRecord> {
    const current = await this.getUser(id);
    await assertUserUpdateAllowed(actor, current, input, () => this.activeAdminCount());
    const fields = await userChanges(current, input);
    if (Object.keys(fields).length) await this.users.update(id, { ...fields, updated_at: new Date().toISOString() });
    if (input.disabled || input.password !== undefined) await this.sessions.deleteForUser(id);
    return this.getUser(id);
  }

  async deleteUser(actor: Identity, id: string): Promise<UserRecord> {
    const current = await this.getUser(id);
    if (actor.kind === "user" && actor.id === id)
      throw new AppError(409, "SELF_DELETE", "No puedes eliminar tu propia cuenta");
    if (current.role === "admin" && !current.disabledAt && (await this.activeAdminCount()) <= 1)
      throw new AppError(409, "LAST_ADMIN", "Debe quedar al menos un administrador activo");
    const namespaces = await this.users.ownedNamespaces(id);
    const packages = new NamespacesRepository(this.context);
    for (const namespace of namespaces) {
      const published = await packages.publishedVersions(namespace);
      if (published)
        throw new AppError(
          409,
          "USER_OWNS_PACKAGES",
          `${current.username} es dueño de ${namespace}, que tiene ${published} versión(es) publicadas. Pásalo a otro dueño o elimina sus paquetes antes.`,
        );
    }
    await this.users.deleteRevokingKeys(id, new Date().toISOString(), namespaces);
    return current;
  }

  private async assertNamespaceFree(username: string): Promise<void> {
    const namespace = personalNamespace(username);
    if (await this.users.namespaceTaken(namespace))
      throw new AppError(
        409,
        "USERNAME_TAKEN",
        `El namespace ${namespace} ya existe y sería el namespace personal de este usuario. Elige otro nombre.`,
      );
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string, keepToken?: string) {
    const row = await this.users.findById(userId);
    if (!row || row.disabled_at) throw new AppError(401, "UNAUTHORIZED", "Sesión inválida");
    if (typeof currentPassword !== "string" || !(await verifyPassword(currentPassword, row.password_hash)))
      throw new AppError(400, "INVALID_PASSWORD", "La contraseña actual no es correcta");
    invariant(
      currentPassword !== newPassword,
      400,
      "INVALID_PASSWORD",
      "La nueva contraseña debe ser distinta de la actual",
    );
    assertPassword(newPassword, row.username);
    const hash = await hashPassword(newPassword);
    await this.users.update(userId, { password_hash: hash, updated_at: new Date().toISOString() });
    await this.sessions.deleteForUser(userId, keepToken ? sha256(keepToken) : "");
  }

  async verifyLogin(
    usernameInput: unknown,
    password: unknown,
    address = "",
  ): Promise<{ user?: UserRecord; locked: boolean }> {
    const username = typeof usernameInput === "string" ? usernameInput.trim().toLowerCase().slice(0, 64) : "";
    const pass = typeof password === "string" ? password.slice(0, MAX_PASSWORD_LENGTH) : "";
    const key = `${username}\u0000${address}`;
    const now = Date.now();
    const locked = this.throttle.isLocked(key, now);
    const row = username ? await this.users.findByUsername(username) : undefined;
    const valid = await verifyPassword(pass, row?.password_hash ?? (await decoyPasswordHash()));
    if (locked) return { locked: true };
    if (!row || !valid || row.disabled_at || !pass) {
      this.throttle.fail(key, now);
      return { locked: false };
    }
    this.throttle.clear(key);
    return { user: toUser(row), locked: false };
  }
}
