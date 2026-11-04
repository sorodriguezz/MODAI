import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signaturePolicySchema } from "@modai/contracts/schemas";
import type { SignaturePolicy } from "@modai/contracts/types";

export interface AppOptions {
  databasePath?: string;
  databaseUrl?: string;
  artifactDirectory: string;
  apiToken?: string;
  logger?: boolean;
  signaturePolicy?: SignaturePolicy;
  maxArtifactStorageBytes?: number;
  rateLimitMax?: number;
  workerLeaseMs?: number;
  adminDirectory?: string | false;
  publicUrl?: string;
  trustProxy?: boolean | number | string;
  initialAdmin?: { username: string; password: string } | false;
  sessionIdleMs?: number;
  sessionMaxMs?: number;
  loginRateLimitMax?: number;
  loginDelayMs?: number;
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function optionsFromEnvironment(env: NodeJS.ProcessEnv = process.env): AppOptions {
  const runtimeDirectory = fileURLToPath(new URL("../var/", import.meta.url));
  return {
    databaseUrl: env.MODAI_DATABASE_URL?.trim() || undefined,
    databasePath: resolve(env.MODAI_DATABASE_PATH ?? resolve(runtimeDirectory, "data/modularai.db")),
    artifactDirectory: resolve(env.MODAI_ARTIFACT_DIR ?? resolve(runtimeDirectory, "artifacts")),
    apiToken: env.MODAI_API_TOKEN,
    publicUrl: env.MODAI_PUBLIC_URL,
    trustProxy: parseTrustProxy(env.MODAI_TRUST_PROXY),
    signaturePolicy: signaturePolicySchema.parse(env.MODAI_SIGNATURE_POLICY ?? "optional"),
    maxArtifactStorageBytes: Number(env.MODAI_ARTIFACT_QUOTA_BYTES ?? 1024 * 1024 * 1024),
    ...(Number(env.MODAI_LOGIN_RATE_LIMIT) > 0 ? { loginRateLimitMax: Number(env.MODAI_LOGIN_RATE_LIMIT) } : {}),
  };
}
