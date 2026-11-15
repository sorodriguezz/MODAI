import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { linkSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function readKey(path: string): Buffer {
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error("La clave local de MFA tiene un tamaño inválido");
  return key;
}

export function loadMfaKey(directory: string, configured?: string): Buffer {
  if (configured !== undefined) {
    const key = Buffer.from(configured, "base64url");
    if (key.length !== 32 || key.toString("base64url") !== configured)
      throw new Error("MODAI_MFA_KEY necesita 32 bytes en base64url sin relleno");
    return key;
  }
  const path = join(directory, ".mfa-key");
  try {
    return readKey(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(directory, `.mfa-key-${randomUUID()}`);
  try {
    writeFileSync(temporary, randomBytes(32), { mode: 0o600, flag: "wx" });
    linkSync(temporary, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
  return readKey(path);
}

export function sealMfa(key: Buffer, purpose: string, payload: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce).setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function openMfa(key: Buffer, purpose: string, sealed: string): Buffer | undefined {
  const data = Buffer.from(sealed, "base64url");
  if (data.length <= 28 || data.toString("base64url") !== sealed) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12))
      .setAAD(Buffer.from(purpose))
      .setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
  } catch {
    return undefined;
  }
}
