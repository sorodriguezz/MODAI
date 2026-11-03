import { AppError } from "@modai/contracts/errors";
import type { LockedPackageV1, LockFile } from "@modai/contracts/manifest";
import type { InstallUnit } from "../installation/desired-state.js";
import { computeIntegrity, type TrustPolicy, verifyFiles, verifySignature } from "../packages/integrity.js";
import { applyPackageFeatures } from "../packages/package-features.js";
import { validatePackage } from "../packages/validate.js";
import type { CompositeRegistry } from "../registries/composite-registry.js";
import type { PackageArtifact } from "../registries/registry.js";
import type { Resolution, ResolvedNode } from "../resolution/resolver.js";
import type { WorkspaceRef } from "./file-dependencies.js";

export interface InstallSet {
  units: InstallUnit[];
  artifacts: Map<string, PackageArtifact>;
  lockedPackages: Record<string, LockedPackageV1>;
}

function assertLockIntegrity(node: ResolvedNode<WorkspaceRef>, previousLock: LockFile, integrity: string): void {
  const previous = previousLock.packages[node.name];
  if (previous && previous.version === node.version && previous.integrity !== integrity && node.ref.kind === "registry")
    throw new AppError(
      409,
      "LOCK_INTEGRITY_MISMATCH",
      `${node.name}@${node.version} no coincide con la integridad de modai.lock (${previous.integrity}). El registry sirvió contenido distinto para la misma versión.`,
    );
}

async function installNode(
  node: ResolvedNode<WorkspaceRef>,
  context: { registry: CompositeRegistry; lock: LockFile; trust: TrustPolicy; resolution: Resolution<WorkspaceRef> },
  set: InstallSet,
): Promise<void> {
  const artifact = node.ref.kind === "file" ? node.ref.artifact : await context.registry.fetch(node.name, node.version);
  verifyFiles(node.name, artifact.files);
  const manifest = validatePackage(artifact.manifest, artifact.files);
  if (manifest.metadata.name !== node.name || manifest.metadata.version !== node.version)
    throw new AppError(
      400,
      "IDENTITY_MISMATCH",
      `El registry devolvió ${manifest.metadata.name}@${manifest.metadata.version} en lugar de ${node.name}@${node.version}`,
    );
  const integrity = computeIntegrity(artifact.manifest, artifact.files);
  assertLockIntegrity(node, context.lock, integrity);
  const signer =
    node.ref.kind === "registry"
      ? verifySignature(node.name, artifact.manifest, artifact.files, artifact.signature, context.trust)
      : undefined;
  const files = new Map(artifact.files.map((item) => [item.path, Buffer.from(item.content, "base64")]));
  const applied = applyPackageFeatures(manifest, files, node.features);
  set.units.push({ name: node.name, version: node.version, manifest: applied.manifest, files: applied.files });
  set.lockedPackages[node.name] = {
    version: node.version,
    source: artifact.source,
    integrity,
    ...(signer ? { signer } : {}),
    kind: manifest.kind,
    category: manifest.spec.category,
    dependencies: node.dependencies,
    provides: manifest.spec.provides.map((item) => `${item.capability}@${item.version}`),
    requires: context.resolution.requires[node.name] ?? {},
    permissions: [...manifest.spec.permissions].sort(),
    features: node.features,
  };
  set.artifacts.set(node.name, { ...artifact, integrity });
}

export async function collectInstallSet(
  resolution: Resolution<WorkspaceRef> | undefined,
  context: { registry: CompositeRegistry; lock: LockFile; trust: TrustPolicy },
): Promise<InstallSet> {
  const set: InstallSet = { units: [], artifacts: new Map(), lockedPackages: {} };
  if (!resolution) return set;
  for (const node of resolution.packages) await installNode(node, { ...context, resolution }, set);
  return set;
}
