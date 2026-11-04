import type { Command } from "commander";
import { loadLocalModels } from "../../client/embeddings.js";
import { detectHardware, recommendModels } from "../../client/hardware.js";
import { LocalOllama } from "../../client/ollama.js";
import type { Print } from "../../terminal/output.js";

const SAMPLES = [
  "Cómo separar dominio y persistencia",
  "When to use the Strategy design pattern",
  "Decisiones y memoria de un proyecto",
];

export function registerClientDoctor(client: Command, print: Print): void {
  client
    .command("doctor")
    .option("--url <url>", "Ollama de este equipo", "http://127.0.0.1:11434")
    .action(async (options: { url: string }) => {
      const runtime = new LocalOllama(options.url);
      const hardware = await detectHardware();
      let ollama: unknown;
      try {
        ollama = { available: true, ...(await runtime.status()) };
      } catch (e) {
        ollama = { available: false, message: (e as Error).message };
      }
      print({
        hardware,
        recommendation: recommendModels(hardware),
        ollama,
        next: "modai client setup --download",
        privacy: "El diagnóstico se ejecuta y muestra en este cliente; no se sube al servidor MODAI.",
      });
    });
}

async function measure(runtime: LocalOllama, model: string) {
  try {
    await runtime.model(model);
    const cold = performance.now();
    await runtime.embed(model, ["Prueba de búsqueda multilingüe"]);
    const loadAndFirstMs = Math.round(performance.now() - cold),
      samples = [];
    for (const input of SAMPLES) {
      const start = performance.now();
      const [v] = await runtime.embed(model, [input]);
      samples.push({ ms: Math.round(performance.now() - start), dimensions: v.length });
    }
    return {
      model,
      loadAndFirstMs,
      samples,
      meanWarmMs: Math.round(samples.reduce((s, v) => s + v.ms, 0) / samples.length),
    };
  } catch (e) {
    return { model, error: (e as Error).message };
  }
}

export function registerClientBenchmark(client: Command, print: Print): void {
  client
    .command("benchmark")
    .description("Mide latencia de embeddings con modelos ya instalados, sin descargar")
    .option("--models <names>", "Modelos separados por comas; por defecto el configurado")
    .option("--url <url>", "Runtime local; por defecto el configurado")
    .action(async (o: { models?: string; url?: string }) => {
      const config = o.models ? undefined : loadLocalModels();
      const runtime = new LocalOllama(o.url ?? config?.url);
      const names = o.models
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [config!.embeddingModel];
      const results = [];
      for (const model of names) results.push(await measure(runtime, model));
      print({
        results,
        note: "Latencia local con textos cortos; no mide calidad de recuperación. No cambia el modelo configurado. Evalúa también consultas representativas de tu proyecto.",
      });
    });
}
