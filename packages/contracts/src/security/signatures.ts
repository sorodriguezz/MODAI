import { createPublicKey, verify } from "node:crypto";
import { sha256 } from "./hashing.js";

export function publicKeyFingerprint(publicKey: string): string {
  const key = createPublicKey(publicKey);
  const der = key.export({ type: "spki", format: "der" });
  return sha256(der);
}

export function signaturePayload(manifest: unknown, files: Array<{ path: string; sha256: string }>): Buffer {
  const normalized = {
    manifest,
    files: [...files]
      .map(({ path, sha256: hash }) => ({ path, sha256: hash }))
      .sort((a, b) => a.path.localeCompare(b.path)),
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
