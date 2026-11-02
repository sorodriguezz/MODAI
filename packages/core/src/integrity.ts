import { publicKeyFingerprint, sha256, signaturePayload, verifyEd25519 } from "@modai/contracts/security";
import type { ArtifactFile, PackageSignature, SignaturePolicy } from "@modai/contracts/types";
import { AppError } from "@modai/contracts/errors";

/** Content address of a package: manifest as published plus every file hash. Independent of the registry that served it. */
export function computeIntegrity(manifest: unknown, files: Array<{ path: string; sha256: string }>): string {
  return `sha256-${sha256(signaturePayload(manifest, files))}`;
}

/** Verifies that every file matches its declared hash and that paths are unique. */
export function verifyFiles(label: string, files: ArtifactFile[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) throw new AppError(400, "DUPLICATE_FILE", `Archivo duplicado en ${label}: ${file.path}`);
    seen.add(file.path);
    if (sha256(Buffer.from(file.content, "base64")) !== file.sha256) throw new AppError(400, "INTEGRITY_MISMATCH", `Integridad inválida: ${label}:${file.path}`);
  }
}

export interface TrustPolicy { policy: SignaturePolicy; trustedPublishers: string[] }

/** Applies the signature policy. Returns the signer fingerprint when the artifact is signed. */
export function verifySignature(label: string, manifest: unknown, files: ArtifactFile[], signature: PackageSignature | undefined, trust: TrustPolicy): string | undefined {
  if (!signature) {
    if (trust.policy !== "optional") throw new AppError(403, "SIGNATURE_REQUIRED", `Firma requerida para ${label}`);
    return undefined;
  }
  if (signature.algorithm !== "ed25519" || !verifyEd25519(signature.publicKey, signature.signature, signaturePayload(manifest, files))) {
    throw new AppError(403, "INVALID_SIGNATURE", `Firma inválida: ${label}`);
  }
  const fingerprint = publicKeyFingerprint(signature.publicKey);
  if (trust.policy === "trusted" && !trust.trustedPublishers.includes(fingerprint)) throw new AppError(403, "UNTRUSTED_PUBLISHER", `Publicador no autorizado localmente: ${fingerprint}`);
  return fingerprint;
}
