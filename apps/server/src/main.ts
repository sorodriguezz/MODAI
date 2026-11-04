import { createApp } from "./app.js";
import { optionsFromEnvironment } from "./config.js";

const host = process.env.MODAI_HOST ?? "0.0.0.0";
const port = Number(process.env.MODAI_PORT ?? process.env.PORT ?? 8787);

const app = await createApp(optionsFromEnvironment());

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
