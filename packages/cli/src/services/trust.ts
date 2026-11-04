import type { ProjectFile } from "@modai/contracts/manifest";
import { publicKeyFingerprint, sha256, signaturePayload, verifyEd25519 } from "@modai/contracts/security";
import type { ArtifactFile, PackageRecord, SignaturePolicy } from "@modai/contracts/types";
import type { SyncOptions } from "@modai/core";
import type { ApiClient } from "@modai/sdk";
import { loadClientConfig } from "./config.js";

const POLICIES: SignaturePolicy[] = ["optional", "signed", "trusted"];

function verifyFiles(item: PackageRecord, artifact: { files: ArtifactFile[]; sha256: string }): void {
  if (sha256(JSON.stringify({ files: artifact.files })) !== artifact.sha256)
    throw new Error(`Integridad del artefacto inválida: ${item.name}`);
  const paths = new Set<string>();
  for (const file of artifact.files) {
    if (paths.has(file.path) || sha256(Buffer.from(file.content, "base64")) !== file.sha256)
      throw new Error(`Integridad inválida: ${item.name}:${file.path}`);
    paths.add(file.path);
  }
}

export function verifyPackage(
  item: PackageRecord,
  artifact: { files: ArtifactFile[]; sha256: string },
  policy: SignaturePolicy = "optional",
  trustedPublishers: string[] = [],
): void {
  verifyFiles(item, artifact);
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

export type InstallationPolicy = { policy: SignaturePolicy; trustedPublishers: string[] };

export async function installationPolicy(
  api: ApiClient,
  project: { signaturePolicy?: SignaturePolicy } = {},
): Promise<InstallationPolicy> {
  const global = loadClientConfig(),
    health = await api.health();
  const rank = Math.max(
    ...[global?.signaturePolicy, project.signaturePolicy, health.signaturePolicy].map((value) =>
      POLICIES.indexOf(value ?? "optional"),
    ),
  );
  return { policy: POLICIES[Math.max(rank, 0)], trustedPublishers: global?.trustedPublishers ?? [] };
}

export function trustPolicy(file: ProjectFile): SyncOptions["trust"] {
  const config = loadClientConfig();
  const rank = Math.max(
    POLICIES.indexOf(config?.signaturePolicy ?? "optional"),
    POLICIES.indexOf(file.signaturePolicy ?? "optional"),
  );
  return { policy: POLICIES[Math.max(rank, 0)], trustedPublishers: config?.trustedPublishers ?? [] };
}

export function strictestPolicy(...values: Array<SignaturePolicy | undefined>): SignaturePolicy {
  return POLICIES[Math.max(...values.map((value) => POLICIES.indexOf(value ?? "optional")))];
}
