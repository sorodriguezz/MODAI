import { randomBytes } from "node:crypto";
import { invariant } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import { openMfa, sealMfa } from "./mfa-key.js";
import { verifyPassword } from "./passwords.js";
import { SessionsRepository } from "./sessions.repository.js";
import { base32, matchingTotpStep } from "./totp.js";
import { type UserRow, UsersRepository } from "./users.repository.js";
import { type FactorProof, updateVerifiedUser, type VerifiedUser } from "./verified-user.js";

const SETUP_TTL = 10 * 60_000;
const SECRET_SIZE = 20;
const secretPurpose = (userId: string) => `modai:mfa:totp:${userId}`;
const setupPurpose = (user: UserRow, session: string) =>
  `modai:mfa:setup:${user.id}:${user.updated_at}:${user.password_hash}:${sha256(session)}`;

const recoveryDigests = (user: UserRow): string[] => JSON.parse(user.mfa_recovery_json ?? "[]");

function generateRecovery() {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(16)
      .toString("hex")
      .replace(/(.{8})(?=.)/g, "$1-"),
  );
  return { codes, digests: JSON.stringify(codes.map((code) => sha256(code.replaceAll("-", "")))) };
}

export class MfaService {
  private readonly users: UsersRepository;

  constructor(
    private readonly context: DataContext,
    private readonly key: Buffer,
  ) {
    this.users = new UsersRepository(context);
  }

  verify(user: UserRow, code: string): FactorProof | undefined {
    if (!user.mfa_secret) return undefined;
    const normalized = code.trim().toLowerCase().replaceAll("-", "");
    if (/^[a-f0-9]{32}$/.test(normalized)) {
      const hashes = recoveryDigests(user);
      const digest = sha256(normalized);
      if (hashes.includes(digest)) return { remainingCodes: JSON.stringify(hashes.filter((hash) => hash !== digest)) };
      return undefined;
    }
    const secret = openMfa(this.key, secretPurpose(user.id), user.mfa_secret);
    const step = secret && matchingTotpStep(secret, code.trim());
    if (step !== undefined && step > (user.mfa_last_step ?? -1)) return { step };
    return undefined;
  }

  async status(userId: string) {
    const user = await this.requireUser(userId);
    return { enabled: Boolean(user.mfa_secret), recoveryCodesRemaining: recoveryDigests(user).length };
  }

  async begin(userId: string, session: string, password: string) {
    const user = await this.requireUser(userId, password);
    invariant(!user.mfa_secret, 409, "MFA_ENABLED", "La verificación en dos pasos ya está activada");
    const secret = randomBytes(SECRET_SIZE);
    const expiresAt = Date.now() + SETUP_TTL;
    const input = Buffer.alloc(8 + SECRET_SIZE);
    input.writeBigUInt64BE(BigInt(expiresAt));
    secret.copy(input, 8);
    const setupToken = sealMfa(this.key, setupPurpose(user, session), input);
    return { secret: base32(secret), setupToken, expiresAt: new Date(expiresAt).toISOString() };
  }

  async confirm(userId: string, session: string, setupToken: string, code: string) {
    const user = await this.requireUser(userId);
    invariant(!user.mfa_secret, 409, "MFA_ENABLED", "La verificación en dos pasos ya está activada");
    const draft = openMfa(this.key, setupPurpose(user, session), setupToken);
    invariant(
      draft?.length === 8 + SECRET_SIZE && draft.readBigUInt64BE() > BigInt(Date.now()),
      400,
      "MFA_SETUP_EXPIRED",
      "Comienza de nuevo la configuración de la verificación en dos pasos",
    );
    const secret = draft.subarray(8);
    const step = matchingTotpStep(secret, code.trim());
    invariant(step !== undefined, 400, "INVALID_MFA", "El código de la aplicación no es válido o ya venció");
    const { codes, digests } = generateRecovery();
    await this.change({ user }, session, {
      mfa_secret: sealMfa(this.key, secretPurpose(user.id), secret),
      mfa_last_step: step,
      mfa_recovery_json: digests,
    });
    return { recoveryCodes: codes };
  }

  async replaceRecovery(userId: string, session: string, password: string, code: string) {
    const verified = await this.requireFactor(userId, password, code);
    const { codes, digests } = generateRecovery();
    await this.change(verified, session, { mfa_recovery_json: digests });
    return { recoveryCodes: codes };
  }

  async disable(userId: string, session: string, password: string, code: string) {
    const verified = await this.requireFactor(userId, password, code);
    await this.change(verified, session, { mfa_secret: null, mfa_last_step: null, mfa_recovery_json: null });
  }

  private async requireUser(userId: string, password?: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    invariant(user && !user.disabled_at, 401, "UNAUTHORIZED", "Sesión inválida");
    if (password !== undefined)
      invariant(
        await verifyPassword(password, user.password_hash),
        400,
        "INVALID_PASSWORD",
        "La contraseña actual no es correcta",
      );
    return user;
  }

  private async requireFactor(userId: string, password: string, code: string): Promise<VerifiedUser> {
    const user = await this.requireUser(userId, password);
    invariant(user.mfa_secret, 409, "MFA_DISABLED", "La verificación en dos pasos está desactivada");
    const proof = this.verify(user, code);
    invariant(proof, 400, "INVALID_MFA", "El código es incorrecto, venció o ya fue utilizado");
    return { user, proof };
  }

  private async change(
    verified: VerifiedUser,
    session: string,
    changes: { mfa_secret?: string | null; mfa_last_step?: number | null; mfa_recovery_json: string | null },
  ): Promise<void> {
    await withTransaction(this.context, async (trx) => {
      const changed = await updateVerifiedUser(trx, verified, { ...changes, updated_at: new Date().toISOString() });
      invariant(changed, 409, "MFA_CHANGED", "La cuenta o el código cambiaron. Vuelve a intentarlo.");
      await new SessionsRepository(trx).deleteForUser(verified.user.id, sha256(session));
    });
  }
}
