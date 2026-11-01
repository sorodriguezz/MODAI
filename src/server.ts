import { resolve } from "node:path";
import { createApp } from "./http/app.js";

const host = process.env.MODAI_HOST ?? "0.0.0.0";
const port = Number(process.env.MODAI_PORT ?? 8787);
const databasePath = resolve(process.env.MODAI_DATABASE_PATH ?? "./var/data/modularai.db");
const artifactDirectory = resolve(process.env.MODAI_ARTIFACT_DIR ?? "./var/artifacts");

const app = await createApp({
  databasePath,
  artifactDirectory,
  apiToken: process.env.MODAI_API_TOKEN,
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
