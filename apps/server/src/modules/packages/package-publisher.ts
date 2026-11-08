import { randomUUID } from "node:crypto";
import { invariant } from "@modai/contracts/errors";
import { analyzePackageQuality } from "@modai/contracts/quality";
import { parseInput, publishSchema } from "@modai/contracts/schemas";
import { publicKeyFingerprint, sha256, signaturePayload, verifyEd25519 } from "@modai/contracts/security";
import type { PublishPackageInput, SignaturePolicy } from "@modai/contracts/types";
import { manifestIdentity, normalizeManifest, validatePackage } from "@modai/core";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import type { ArtifactStore } from "../../infrastructure/storage/artifact-store.js";
import { PackagesRepository } from "./packages.repository.js";
import { PublishersRepository } from "./publishers.repository.js";

export interface PublishSettings {
  artifacts: ArtifactStore;
  signaturePolicy: SignaturePolicy;
  maxStorageBytes: number;
}

function assertQuality(input: PublishPackageInput) {
  const quality = analyzePackageQuality(input.manifest, input.files);
  const errors = quality.findings.filter((item) => item.severity === "error");
  invariant(!errors.length, 400, "PACKAGE_QUALITY_FAILED", errors.map((item) => item.message).join(" "));
  return quality;
}

async function verifySignature(context: DataContext, input: PublishPackageInput, policy: SignaturePolicy) {
  let signer: string | null = null;
  if (input.signature) {
    invariant(input.signature.algorithm === "ed25519", 400, "UNSUPPORTED_SIGNATURE", "Solo se admite ed25519");
    const payload = signaturePayload(input.manifest, input.files);
    invariant(
      verifyEd25519(input.signature.publicKey, input.signature.signature, payload),
      400,
      "INVALID_SIGNATURE",
      "La firma del paquete no es válida",
    );
    signer = publicKeyFingerprint(input.signature.publicKey);
  }
  if (policy === "trusted") {
    const publisher = signer ? await new PublishersRepository(context).find(signer) : undefined;
    invariant(publisher?.trusted, 403, "UNTRUSTED_PUBLISHER", "El servidor exige un publicador de confianza");
  }
  return signer;
}

async function assertCapacity(packages: PackagesRepository, input: PublishPackageInput, body: string, max: number) {
  const identity = manifestIdentity(input.manifest);
  const exists = await packages.byNameVersion(identity.name, identity.version);
  invariant(!exists, 409, "PACKAGE_EXISTS", `${identity.name}@${identity.version} ya existe y es inmutable`);
  invariant((await packages.count()) < 20000, 429, "PACKAGE_QUOTA", "Cuota de versiones publicadas alcanzada");
  invariant(
    (await packages.storageBytes()) + Buffer.byteLength(body) <= max,
    413,
    "STORAGE_QUOTA",
    "Cuota de artefactos alcanzada",
  );
}

async function writeRows(
  context: DataContext,
  input: PublishPackageInput,
  record: { artifactId: string; body: string; signer: string | null; quality: unknown },
) {
  const normalized = normalizeManifest(input.manifest);
  const identity = manifestIdentity(input.manifest);
  const now = new Date().toISOString();
  const packages = new PackagesRepository(context);
  const size = Buffer.byteLength(record.body);
  await packages.insertArtifact({
    id: record.artifactId,
    sha256: sha256(record.body),
    size_bytes: size,
    created_at: now,
  });
  await packages.insertPackage({
    name: identity.name,
    version: identity.version,
    type: normalized.spec.category,
    description: normalized.metadata.description,
    manifest_json: JSON.stringify(input.manifest),
    artifact_id: record.artifactId,
    published_at: now,
    status: "active",
    signer_fingerprint: record.signer,
    signature: input.signature?.signature ?? null,
    quality_json: JSON.stringify(record.quality),
  });
  if (input.signature && record.signer)
    await new PublishersRepository(context).ensureKey(record.signer, input.signature.publicKey, now);
  const byPath = new Map(input.files.map((file) => [file.path, file]));
  for (const rule of normalized.spec.contributes.knowledge) {
    const content = Buffer.from(byPath.get(rule.path)!.content, "base64").toString("utf8");
    await packages.insertKnowledge({
      id: randomUUID(),
      package_name: identity.name,
      package_version: identity.version,
      title: rule.title,
      content,
      tags_json: JSON.stringify(rule.tags ?? []),
      created_at: now,
      updated_at: now,
    });
  }
}

export async function publishPackage(
  context: DataContext,
  settings: PublishSettings,
  input: PublishPackageInput,
  artifactId: string = randomUUID(),
) {
  parseInput(publishSchema, input);
  validatePackage(input.manifest, input.files);
  invariant(
    settings.signaturePolicy === "optional" || Boolean(input.signature),
    400,
    "SIGNATURE_REQUIRED",
    "El servidor exige paquetes firmados",
  );
  const quality = assertQuality(input);
  const signer = await verifySignature(context, input, settings.signaturePolicy);
  const body = JSON.stringify({ files: input.files });
  await assertCapacity(new PackagesRepository(context), input, body, settings.maxStorageBytes);
  settings.artifacts.create(artifactId, body);
  try {
    await withTransaction(context, (trx) => writeRows(trx, input, { artifactId, body, signer, quality }));
  } catch (error) {
    settings.artifacts.remove(artifactId);
    throw error;
  }
  return manifestIdentity(input.manifest);
}
