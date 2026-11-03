import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signaturePolicySchema } from "@modai/contracts/schemas";
import { createApp } from "./http/app.js";

const host = process.env.MODAI_HOST ?? "0.0.0.0";
// MODAI_PORT wins; PORT is the convention injected by platforms such as Railway.
const port = Number(process.env.MODAI_PORT ?? process.env.PORT ?? 8787);
function parseTrustProxy(value: string | undefined): boolean | number | string {
  if (!value || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value;
}
const runtimeDirectory = fileURLToPath(new URL("../var/", import.meta.url));
const databasePath = resolve(process.env.MODAI_DATABASE_PATH ?? resolve(runtimeDirectory, "data/modularai.db"));
const artifactDirectory = resolve(process.env.MODAI_ARTIFACT_DIR ?? resolve(runtimeDirectory, "artifacts"));

const app = await createApp({
  databasePath,
  artifactDirectory,
  apiToken: process.env.MODAI_API_TOKEN,
  publicUrl: process.env.MODAI_PUBLIC_URL,
  trustProxy: parseTrustProxy(process.env.MODAI_TRUST_PROXY),
  signaturePolicy: signaturePolicySchema.parse(process.env.MODAI_SIGNATURE_POLICY ?? "optional"),
  maxArtifactStorageBytes: Number(process.env.MODAI_ARTIFACT_QUOTA_BYTES ?? 1024 * 1024 * 1024),
  // Login and first-run attempts per minute and IP (default 10).
  ...(Number(process.env.MODAI_LOGIN_RATE_LIMIT) > 0
    ? { loginRateLimitMax: Number(process.env.MODAI_LOGIN_RATE_LIMIT) }
    : {}),
});

const close = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Cerrando ModularAI");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void close("SIGINT"));
process.on("SIGTERM", () => void close("SIGTERM"));

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
