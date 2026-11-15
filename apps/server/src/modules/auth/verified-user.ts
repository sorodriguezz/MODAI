import type { Updateable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { UsersTable } from "../../infrastructure/database/schema.js";
import { affectedRows } from "../../infrastructure/database/sql-helpers.js";
import type { UserRow } from "./users.repository.js";

export type FactorProof = { step: number } | { remainingCodes: string };
export interface VerifiedUser {
  user: UserRow;
  proof?: FactorProof;
}

export async function updateVerifiedUser(
  context: DataContext,
  { user, proof }: VerifiedUser,
  changes: Updateable<UsersTable>,
): Promise<boolean> {
  let update = context.db
    .updateTable("users")
    .set({
      ...(proof && ("step" in proof ? { mfa_last_step: proof.step } : { mfa_recovery_json: proof.remainingCodes })),
      ...changes,
    })
    .where("id", "=", user.id)
    .where("password_hash", "=", user.password_hash)
    .where("disabled_at", "is", null)
    .where("mfa_secret", user.mfa_secret === null ? "is" : "=", user.mfa_secret);
  if (proof)
    update =
      "step" in proof
        ? update.where("mfa_last_step", "<", proof.step)
        : update.where("mfa_recovery_json", "=", user.mfa_recovery_json);
  return affectedRows(await update.executeTakeFirst()) > 0;
}
