import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { signaturePolicySchema } from "@modai/contracts/schemas";
import { createApp } from "./http/app.js";

const host = process.env.MODAI_HOST ?? "0.0.0.0";
const port = Number(process.env.MODAI_PORT ?? 8787);
const runtimeDirectory = fileURLToPath(new URL("../var/", import.meta.url));
const databasePath = resolve(process.env.MODAI_DATABASE_PATH ?? resolve(runtimeDirectory, "data/modularai.db"));
const artifactDirectory = resolve(process.env.MODAI_ARTIFACT_DIR ?? resolve(runtimeDirectory, "artifacts"));

const app = await createApp({
  databasePath,
  artifactDirectory,
  apiToken: process.env.MODAI_API_TOKEN,
  publicUrl: process.env.MODAI_PUBLIC_URL,
  signaturePolicy: signaturePolicySchema.parse(process.env.MODAI_SIGNATURE_POLICY ?? "optional"),
  maxArtifactStorageBytes: Number(process.env.MODAI_ARTIFACT_QUOTA_BYTES ?? 1024 * 1024 * 1024),
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
