import { randomBytes, type ScryptOptions, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { invariant } from "@modai/contracts/errors";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./identity.js";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let decoyHash: Promise<string> | undefined;

// why: unknown usernames still pay the scrypt cost, so response times do not reveal which accounts exist.
export function decoyPasswordHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(18).toString("base64url"));
  return decoyHash;
}

export function normalizeUsername(value: unknown): string {
  const username = typeof value === "string" ? value.trim().toLowerCase() : "";
  invariant(
    USERNAME_PATTERN.test(username),
    400,
    "INVALID_USERNAME",
    "El usuario debe tener de 3 a 64 caracteres: letras, números, punto, guion o guion bajo",
  );
  return username;
}

export function assertPassword(password: unknown, username: string): asserts password is string {
  invariant(
    typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH,
    400,
    "WEAK_PASSWORD",
    `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
  );
  invariant(
    password.length <= MAX_PASSWORD_LENGTH,
    400,
    "WEAK_PASSWORD",
    `La contraseña admite hasta ${MAX_PASSWORD_LENGTH} caracteres`,
  );
  invariant(
    password.toLowerCase() !== username.toLowerCase(),
    400,
    "WEAK_PASSWORD",
    "La contraseña no puede ser igual al usuario",
  );
}
