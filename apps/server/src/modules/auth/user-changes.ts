import { AppError, invariant } from "@modai/contracts/errors";
import type { Updateable } from "kysely";
import type { UsersTable } from "../../infrastructure/database/schema.js";
import { type Identity, ROLES, type UserRecord, type UserUpdate } from "./identity.js";
import { assertPassword, hashPassword } from "./passwords.js";

export async function assertUserUpdateAllowed(
  actor: Identity,
  current: UserRecord,
  input: UserUpdate,
  activeAdmins: () => Promise<number>,
): Promise<void> {
  const self = actor.kind === "user" && actor.id === current.id;
  if (input.role !== undefined) invariant(ROLES.includes(input.role), 400, "INVALID_ROLE", "Rol inválido");
  if (self && input.role !== undefined && input.role !== current.role)
    throw new AppError(409, "SELF_ROLE_CHANGE", "No puedes cambiar tu propio rol");
  if (self && input.disabled) throw new AppError(409, "SELF_DISABLE", "No puedes desactivar tu propia cuenta");
  const losesAdmin =
    current.role === "admin" &&
    !current.disabledAt &&
    ((input.role !== undefined && input.role !== "admin") || input.disabled === true);
  if (losesAdmin && (await activeAdmins()) <= 1)
    throw new AppError(409, "LAST_ADMIN", "Debe quedar al menos un administrador activo");
}

function grantChanges(input: UserUpdate): Updateable<UsersTable> {
  const fields: Updateable<UsersTable> = {};
  if (input.role !== undefined) fields.role = input.role;
  if (input.projectIds !== undefined) fields.project_ids_json = JSON.stringify(input.projectIds);
  if (input.organizationIds !== undefined) fields.organization_ids_json = JSON.stringify(input.organizationIds);
  if (input.packageScopes !== undefined) fields.package_scopes_json = JSON.stringify(input.packageScopes);
  return fields;
}

export async function userChanges(current: UserRecord, input: UserUpdate): Promise<Updateable<UsersTable>> {
  const fields: Updateable<UsersTable> = {};
  if (input.displayName !== undefined) {
    invariant(input.displayName.trim().length > 0, 400, "INVALID_INPUT", "El nombre visible no puede estar vacío");
    fields.display_name = input.displayName.trim().slice(0, 200);
  }
  Object.assign(fields, grantChanges(input));
  if (input.disabled !== undefined)
    fields.disabled_at = input.disabled ? (current.disabledAt ?? new Date().toISOString()) : null;
  if (input.password !== undefined) {
    assertPassword(input.password, current.username);
    fields.password_hash = await hashPassword(input.password);
  }
  return fields;
}
