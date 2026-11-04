import { parseInput, publishSchema } from "@modai/contracts/schemas";
import type { PackageManifest, PackageRecord, PublishPackageInput } from "@modai/contracts/types";
import type { Selectable } from "kysely";
import type { PackagesTable } from "../../infrastructure/database/schema.js";

export type PackageRow = Selectable<PackagesTable>;

export const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

export function rowToPackage(row: PackageRow): PackageRecord {
  return {
    name: row.name,
    version: row.version,
    type: row.type as PackageRecord["type"],
    description: row.description,
    artifactId: row.artifact_id,
    manifest: JSON.parse(row.manifest_json) as PackageManifest,
    publishedAt: row.published_at,
    status: row.status as PackageRecord["status"],
    deprecatedMessage: row.deprecated_message ?? undefined,
    signerFingerprint: row.signer_fingerprint ?? undefined,
    quality: row.quality_json ? JSON.parse(row.quality_json) : undefined,
  };
}

export function validatedPackage(body: unknown): PublishPackageInput {
  parseInput(publishSchema, body);
  return body as PublishPackageInput;
}
