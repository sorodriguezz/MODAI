import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { isAbsolute, posix, win32 } from "node:path";
import { AppError } from "./errors.js";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function assertSafeRelativePath(value: string, label = "path"): void {
  if (typeof value !== "string") throw new AppError(400, "UNSAFE_PATH", `${label} inválido`);
  const normalized = value.replaceAll("\\", "/");
  if (
    typeof value !== "string" || !value ||
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
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
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
    const key = createPublicKey(publicKey);
    return key.asymmetricKeyType === "ed25519" && verify(null, payload, key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function requiredTargetPermission(target: string): "project.instructions" | "project.files" | undefined {
  assertSafeRelativePath(target, "target");
  const normalized = target.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const blocked = new Set([".git", ".github", ".vscode", ".idea", "node_modules", ".ssh"]);
  if (segments.some(segment => !segment || segment === "." || /[:\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || blocked.has(segment.toLowerCase()) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    throw new AppError(400, "UNSAFE_TARGET", `Destino reservado: ${target}`);
  }
  if (/^(?:\.agents\/(?:skills|harness)\/|\.modai\/(?:packages|adapters|integrations)\/)/.test(normalized) || /^\.modai\/[a-z0-9-]+\.md$/i.test(normalized)) return undefined;
  if (/^(?:AGENTS\.md|CLAUDE\.md|\.agent\/|\.opencode\/agents\/)/.test(normalized)) return "project.instructions";
  if (/^docs\//.test(normalized)) return "project.files";
  throw new AppError(400, "UNSAFE_TARGET", `Destino no permitido: ${target}`);
}
