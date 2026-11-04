import type { Command } from "commander";
import { localModelsPath, saveLocalModels } from "../../client/embeddings.js";
import { detectHardware, recommendModels } from "../../client/hardware.js";
import { LocalOllama } from "../../client/ollama.js";
import type { Print } from "../../terminal/output.js";

type SetupOptions = {
  url: string;
  preference: string;
  embeddingModel?: string;
  chatModel?: string;
  download?: boolean;
  withChat?: boolean;
};

const stderrLine = (line: string) => process.stderr.write(`${line}\n`);

function validate(o: SetupOptions): void {
  if (!["balanced", "quality"].includes(o.preference)) throw new Error("--preference debe ser balanced o quality");
  if (o.withChat && !o.download) throw new Error("--with-chat requiere --download");
}

async function download(runtime: LocalOllama, o: SetupOptions, embeddingModel: string, chatModel: string) {
  if (!o.download) return;
  process.stderr.write(`Descargando embeddings en este cliente: ${embeddingModel}\n`);
  await runtime.pull(embeddingModel, stderrLine);
  if (o.withChat) await runtime.pull(chatModel, stderrLine);
}

async function setup(o: SetupOptions) {
  validate(o);
  const hardware = await detectHardware();
  const plan = recommendModels(hardware, o.preference as "balanced" | "quality");
  if (!plan.canEmbed && !o.embeddingModel)
    throw new Error(
      "La memoria libre estimada es baja. Cierra otras aplicaciones, usa búsqueda de texto o elige explícitamente --embedding-model para probar un modelo pequeño.",
    );
  const runtime = new LocalOllama(o.url);
  await runtime.status();
  const embeddingModel = o.embeddingModel ?? plan.embeddingModel,
    chatModel = o.chatModel ?? plan.chatModel;
  await download(runtime, o, embeddingModel, chatModel);
  const model = await runtime.model(embeddingModel);
  const start = performance.now();
  const [vector] = await runtime.embed(embeddingModel, ["Una prueba breve de búsqueda en español."]);
  saveLocalModels({
    schemaVersion: 1,
    url: runtime.url,
    embeddingModel,
    digest: model.digest,
    chatModel,
    batchSize: plan.batchSize,
  });
  const status = await runtime.status();
  return {
    saved: localModelsPath,
    embeddingModel,
    digest: model.digest,
    chatModel,
    chatDownloaded: Boolean(o.download && o.withChat),
    dimensions: vector.length,
    smokeTestMs: Math.round(performance.now() - start),
    running: status.running,
    recommendation: plan,
    next: ["modai client embed index", 'modai client embed search "tu pregunta"'],
    execution: "client-only",
  };
}

export function registerClientSetup(client: Command, print: Print): void {
  client
    .command("setup")
    .description("Selecciona y comprueba modelos locales; --download descarga solo cuando lo solicitas")
    .option("--url <url>", "Ollama local", "http://127.0.0.1:11434")
    .option("--preference <value>", "balanced o quality", "balanced")
    .option("--embedding-model <name>", "Modelo manual; sustituye la recomendación")
    .option("--chat-model <name>", "Modelo recomendado para tu agente")
    .option("--download", "Descarga el modelo de embeddings en este equipo")
    .option("--with-chat", "Descarga también el modelo de chat; requiere --download")
    .action(async (o: SetupOptions) => print(await setup(o)));
}
