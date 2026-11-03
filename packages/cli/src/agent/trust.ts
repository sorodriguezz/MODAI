// Integrity and signature checks for artifacts served by a MODAI server (agent bundles and workers).

import { publicKeyFingerprint, sha256, signaturePayload, verifyEd25519 } from "@modai/contracts/security";
import type { ArtifactFile, PackageRecord, SignaturePolicy } from "@modai/contracts/types";
import type { ApiClient } from "@modai/sdk";
import { loadClientConfig } from "../cli/config.js";

export function verifyPackage(
  item: PackageRecord,
  artifact: { files: ArtifactFile[]; sha256: string },
  policy: SignaturePolicy = "optional",
  trustedPublishers: string[] = [],
): void {
  if (sha256(JSON.stringify({ files: artifact.files })) !== artifact.sha256)
    throw new Error(`Integridad del artefacto inválida: ${item.name}`);
  const paths = new Set<string>();
  for (const file of artifact.files) {
    if (paths.has(file.path) || sha256(Buffer.from(file.content, "base64")) !== file.sha256)
      throw new Error(`Integridad inválida: ${item.name}:${file.path}`);
    paths.add(file.path);
  }
  if (!item.signature) {
    if (policy !== "optional") throw new Error(`Firma requerida para ${item.name}`);
    return;
  }
  const fingerprint = publicKeyFingerprint(item.signature.publicKey);
  if (
    item.signature.algorithm !== "ed25519" ||
    fingerprint !== item.signerFingerprint ||
    !verifyEd25519(item.signature.publicKey, item.signature.signature, signaturePayload(item.manifest, artifact.files))
  )
    throw new Error(`Firma inválida: ${item.name}`);
  if (policy === "trusted" && !trustedPublishers.includes(fingerprint))
    throw new Error(`Publicador no autorizado localmente: ${fingerprint}`);
}

/** The strictest of this machine's, the project's and the server's signature policies. */
export async function installationPolicy(api: ApiClient, project: { signaturePolicy?: SignaturePolicy } = {}) {
  const global = loadClientConfig(),
    health = await api.health();
  const policies: SignaturePolicy[] = ["optional", "signed", "trusted"];
  const rank = Math.max(
    ...[global?.signaturePolicy, project.signaturePolicy, health.signaturePolicy].map((value) =>
      policies.indexOf(value ?? "optional"),
    ),
  );
  return { policy: policies[Math.max(rank, 0)], trustedPublishers: global?.trustedPublishers ?? [] };
}
