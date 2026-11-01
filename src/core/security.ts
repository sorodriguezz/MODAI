import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { isAbsolute, posix, win32 } from "node:path";
import { AppError } from "./errors.js";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function assertSafeRelativePath(value: string, label = "path"): void {
  const normalized = value.replaceAll("\\", "/");
  if (
    !value ||
    value.includes("\0") ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    normalized.startsWith("/") ||
    posix.normalize(normalized).startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new AppError(400, "UNSAFE_PATH", `${label} no es una ruta relativa segura: ${value}`);
  }
}

export function tokensEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function publicKeyFingerprint(publicKey: string): string {
  const key = createPublicKey(publicKey);
  const der = key.export({ type: "spki", format: "der" });
  return sha256(der);
}

export function signaturePayload(manifest: unknown, files: Array<{ path: string; sha256: string }>): Buffer {
  const normalized = {
    manifest,
    files: [...files].map(({ path, sha256: hash }) => ({ path, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path)),
  };
  return Buffer.from(JSON.stringify(normalized), "utf8");
}

export function verifyEd25519(publicKey: string, signature: string, payload: Buffer): boolean {
  try {
    return verify(null, payload, createPublicKey(publicKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
