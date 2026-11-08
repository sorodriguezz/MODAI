import { invariant } from "@modai/contracts/errors";
import {
  capabilityBindingSchema,
  executionPolicySchema,
  memorySchema,
  parseInput,
  projectSchema,
  publishSchema,
} from "@modai/contracts/schemas";
import { publicKeyFingerprint } from "@modai/contracts/security";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { Snapshot } from "./backup-snapshot.js";

type Installation = NonNullable<Snapshot["installations"]>[number];

function assertInstallationShape(item: Installation): void {
  invariant(
    typeof item.projectId === "string" && item.projectId.length > 0 && item.projectId.length <= 200,
    400,
    "INVALID_BACKUP",
    "Instalación sin proyecto válido",
  );
  invariant(
    typeof item.packageName === "string" &&
      /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(item.packageName) &&
      item.packageName.length <= 214,
    400,
    "INVALID_BACKUP",
    `Nombre de paquete inválido en instalaciones: ${item.packageName}`,
  );
  invariant(
    typeof item.version === "string" && item.version.length > 0 && item.version.length <= 100,
    400,
    "INVALID_BACKUP",
    "Versión inválida en instalaciones",
  );
  invariant(
    typeof item.reportedAt === "string" && !Number.isNaN(Date.parse(item.reportedAt)),
    400,
    "INVALID_BACKUP",
    "Fecha inválida en instalaciones",
  );
}

async function projectExists(context: DataContext, id: string): Promise<boolean> {
  return Boolean(await context.db.selectFrom("projects").select("id").where("id", "=", id).executeTakeFirst());
}

function validateContent(snapshot: Snapshot): void {
  for (const item of snapshot.packages) {
    parseInput(publishSchema, { manifest: item.manifest, files: item.files, signature: item.signature });
    invariant(
      item.artifactId === undefined ||
        (typeof item.artifactId === "string" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.artifactId)),
      400,
      "INVALID_BACKUP",
      "Identificador de artefacto inválido",
    );
  }
  for (const {
    createdBy: _createdBy,
    organizationId: _organizationId,
    approval,
    reviewedBy: _reviewedBy,
    reviewAt,
    ...item
  } of snapshot.memories ?? []) {
    parseInput(memorySchema, item);
    invariant(
      item.scope !== "user" &&
        (approval === undefined || [-1, 0, 1].includes(approval)) &&
        (!reviewAt || !Number.isNaN(Date.parse(reviewAt))),
      400,
      "INVALID_BACKUP",
      "Memoria no exportable o revisión inválida",
    );
  }
}

function validateProfiles(snapshot: Snapshot): void {
  for (const { target, approvedBy, updatedAt, ...binding } of snapshot.bindings ?? []) {
    parseInput(capabilityBindingSchema, binding);
    invariant(
      target?.id &&
        ["project", "organization", "team"].includes(target.scope) &&
        approvedBy &&
        !Number.isNaN(Date.parse(updatedAt)),
      400,
      "INVALID_BACKUP",
      "Asignación de capacidades inválida",
    );
  }
  for (const item of snapshot.executionPolicies ?? []) parseInput(executionPolicySchema, item.policy);
}

export async function validateSnapshot(context: DataContext, snapshot: Snapshot): Promise<void> {
  invariant(
    snapshot?.schemaVersion === 1 && Array.isArray(snapshot.packages),
    400,
    "INVALID_BACKUP",
    "Snapshot ModularAI inválido",
  );
  validateContent(snapshot);
  validateProfiles(snapshot);
  for (const item of snapshot.projects ?? [])
    parseInput(projectSchema, { id: item.id, name: item.name, organizationId: item.organizationId ?? undefined });
  const knownProjects = new Set((snapshot.projects ?? []).map((item) => item.id));
  for (const item of snapshot.installations ?? []) {
    assertInstallationShape(item);
    invariant(
      knownProjects.has(item.projectId) || (await projectExists(context, item.projectId)),
      400,
      "INVALID_BACKUP",
      `La instalación apunta a un proyecto ausente: ${item.projectId}`,
    );
  }
  for (const item of snapshot.publishers ?? [])
    invariant(
      publicKeyFingerprint(item.publicKey) === item.fingerprint,
      400,
      "INVALID_PUBLISHER",
      "Fingerprint del publicador inválido",
    );
}
