import type { Command } from "commander";
import type { ApiClient } from "./api.js";
import { detectHardware, recommendModels } from "../client/hardware.js";
import { LocalOllama } from "../client/ollama.js";
import { indexKnowledge, loadLocalModels, localModelsPath, saveLocalModels, semanticSearch } from "../client/embeddings.js";

export function registerClientCommands(program: Command, getApi: () => ApiClient, print: (data: unknown) => void): void {
  const client = program.command("client").description("Hardware, modelos y embeddings en este equipo; sin inferencia en el servidor");
  client.command("doctor")
    .option("--url <url>", "Ollama de este equipo", "http://127.0.0.1:11434")
    .action(async (options: { url: string }) => {
      const runtime = new LocalOllama(options.url);
      const hardware = await detectHardware();
      let ollama: unknown;
      try { ollama = { available: true, ...await runtime.status() }; }
      catch (e) { ollama = { available: false, message: (e as Error).message }; }
      print({ hardware, recommendation: recommendModels(hardware), ollama, next: "modai client setup --download", privacy: "El diagnóstico se ejecuta y muestra en este cliente; no se sube al servidor MODAI." });
    });
  client.command("setup")
    .description("Selecciona y comprueba modelos locales; --download descarga solo cuando lo solicitas")
    .option("--url <url>", "Ollama local", "http://127.0.0.1:11434")
    .option("--preference <value>", "balanced o quality", "balanced")
    .option("--embedding-model <name>", "Modelo manual; sustituye la recomendación")
    .option("--chat-model <name>", "Modelo recomendado para tu agente")
    .option("--download", "Descarga el modelo de embeddings en este equipo")
    .option("--with-chat", "Descarga también el modelo de chat; requiere --download")
    .action(async (o: { url: string; preference: string; embeddingModel?: string; chatModel?: string; download?: boolean; withChat?: boolean }) => {
      if (!["balanced", "quality"].includes(o.preference)) throw new Error("--preference debe ser balanced o quality");
      if (o.withChat && !o.download) throw new Error("--with-chat requiere --download");
      const hardware = await detectHardware();
      const plan = recommendModels(hardware, o.preference as "balanced" | "quality");
      if (!plan.canEmbed && !o.embeddingModel) throw new Error("La memoria libre estimada es baja. Cierra otras aplicaciones, usa búsqueda de texto o elige explícitamente --embedding-model para probar un modelo pequeño.");
      const runtime = new LocalOllama(o.url);
      await runtime.status();
      const embeddingModel = o.embeddingModel ?? plan.embeddingModel, chatModel = o.chatModel ?? plan.chatModel;
      if (o.download) {
        process.stderr.write(`Descargando embeddings en este cliente: ${embeddingModel}\n`);
        await runtime.pull(embeddingModel, (s) => process.stderr.write(s + "\n"));
        if (o.withChat) await runtime.pull(chatModel, (s) => process.stderr.write(s + "\n"));
      }
      const model = await runtime.model(embeddingModel);
      const start = performance.now();
      const [vector] = await runtime.embed(embeddingModel, ["Una prueba breve de búsqueda en español."]);
      saveLocalModels({ schemaVersion: 1, url: runtime.url, embeddingModel, digest: model.digest, chatModel, batchSize: plan.batchSize });
      const status = await runtime.status();
      print({ saved: localModelsPath, embeddingModel, digest: model.digest, chatModel, chatDownloaded: Boolean(o.download && o.withChat), dimensions: vector.length, smokeTestMs: Math.round(performance.now() - start), running: status.running, recommendation: plan, next: ["modai embed index", 'modai embed search "tu pregunta"'], execution: "client-only" });
    });
  client.command("benchmark")
    .description("Mide latencia de embeddings con modelos ya instalados, sin descargar")
    .option("--models <names>", "Modelos separados por comas; por defecto el configurado")
    .option("--url <url>", "Runtime local; por defecto el configurado")
    .action(async (o: { models?: string; url?: string }) => {
      const config = o.models ? undefined : loadLocalModels();
      const runtime = new LocalOllama(o.url ?? config?.url);
      const names = o.models?.split(",").map((s) => s.trim()).filter(Boolean) ?? [config!.embeddingModel];
      const results = [];
      for (const model of names) {
        try {
          await runtime.model(model);
          const cold = performance.now(); await runtime.embed(model, ["Prueba de búsqueda multilingüe"]);
          const loadAndFirstMs = Math.round(performance.now() - cold), samples = [];
          for (const input of ["Cómo separar dominio y persistencia", "When to use the Strategy design pattern", "Decisiones y memoria de un proyecto"]) {
            const start = performance.now(); const [v] = await runtime.embed(model, [input]);
            samples.push({ ms: Math.round(performance.now() - start), dimensions: v.length });
          }
          results.push({ model, loadAndFirstMs, samples, meanWarmMs: Math.round(samples.reduce((s, v) => s + v.ms, 0) / samples.length) });
        } catch (e) { results.push({ model, error: (e as Error).message }); }
      }
      print({ results, note: "Latencia local con textos cortos; no mide calidad de recuperación. No cambia el modelo configurado. Evalúa también consultas representativas de tu proyecto." });
    });

  const embed = program.command("embed").description("Indexación y búsqueda semántica: embeddings calculados solo en el cliente");
  embed.command("index")
    .option("--package <name>", "Indexar solo los documentos de este paquete")
    .action(async (o: { package?: string }) => print(await indexKnowledge(getApi(), loadLocalModels(), (s) => process.stderr.write(s + "\n"), o.package)));
  embed.command("search")
    .argument("<query>")
    .action(async (query: string) => {
      const results = await semanticSearch(getApi(), loadLocalModels(), query);
      print({ results, ...(!results.length ? { hint: "Sin vectores compatibles. Ejecuta modai embed index con este mismo modelo y digest, o usa modai search para búsqueda de texto." } : {}) });
    });
}
