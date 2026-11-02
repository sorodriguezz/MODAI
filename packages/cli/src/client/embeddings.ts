import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readYaml, writeYaml } from "../cli/config.js";
import type { ApiClient } from "@modai/sdk";
import { LocalOllama, localRuntimeUrl } from "./ollama.js";

export const localModelsPath = join(homedir(), ".modai", "local-models.yaml");
export interface LocalModelsConfig {
  schemaVersion: 1;
  url: string;
  embeddingModel: string;
  digest: string;
  chatModel: string;
  batchSize: number;
}
export function loadLocalModels(): LocalModelsConfig {
  if (!existsSync(localModelsPath)) throw new Error("Prepara este cliente con modai client doctor y modai client setup --download.");
  const config = readYaml<LocalModelsConfig>(localModelsPath);
  localRuntimeUrl(config.url);
  if (config.schemaVersion !== 1 || !config.embeddingModel || !config.digest || !Number.isInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 8) throw new Error("Configuración local inválida. Repite modai client setup.");
  return config;
}
export function saveLocalModels(config: LocalModelsConfig): void { writeYaml(localModelsPath, config); }

// Incluye digest y versión de preprocesado: un cambio de pesos nunca mezcla espacios vectoriales.
export function vectorSpace(config: LocalModelsConfig): string {
  return "client-v1:" + createHash("sha256").update(config.embeddingModel + "@" + config.digest).digest("hex");
}
export function sourceHash(doc: { title: string; content: string }): string {
  return createHash("sha256").update(doc.title + "\n" + doc.content).digest("hex");
}

export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  if (!Number.isInteger(size) || size < 1 || overlap < 0 || overlap >= size) throw new Error("Tamaño de fragmento inválido");
  const chars = Array.from(text), result: string[] = [];
  for (let i = 0; i < chars.length; i += size - overlap) {
    result.push(chars.slice(i, i + size).join(""));
    if (i + size >= chars.length) break;
  }
  return result;
}
function prefix(model: string, text: string, query: boolean): string {
  if (model.startsWith("embeddinggemma")) return query ? "task: search result | query: " + text : "title: document | text: " + text;
  if (model.startsWith("qwen3-embedding") && query) return "Instruct: Retrieve relevant technical documentation for the query\nQuery: " + text;
  return text;
}

export function centroid(vectors: number[][]): number[] {
  if (!vectors.length || vectors.some((v) => v.length !== vectors[0].length)) throw new Error("Dimensiones de embeddings incompatibles");
  const mean = Array.from({ length: vectors[0].length }, (_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length);
  const norm = Math.hypot(...mean);
  if (!norm || !Number.isFinite(norm)) throw new Error("El embedding agregado es inválido");
  return mean.map((v) => v / norm);
}

export async function checkedRuntime(config: LocalModelsConfig): Promise<LocalOllama> {
  const runtime = new LocalOllama(config.url);
  if ((await runtime.model(config.embeddingModel)).digest !== config.digest) throw new Error("Los pesos del modelo cambiaron. Ejecuta modai client setup y vuelve a indexar antes de buscar.");
  return runtime;
}

export async function indexKnowledge(api: ApiClient, config: LocalModelsConfig, progress: (s: string) => void = () => {}, packageName?: string) {
  const runtime = await checkedRuntime(config);
  let indexed = 0, skipped = 0, offset = 0;
  while (true) {
    const page = await api.knowledgeDocuments(offset);
    for (const doc of page.documents) {
      if (packageName && doc.packageName !== packageName) { skipped++; continue; }
      const chunks = chunkText(doc.title + "\n" + doc.content);
      if (chunks.length > 1000) throw new Error(`Documento demasiado grande: ${doc.title}. Divídelo en documentos más pequeños.`);
      const vectors: number[][] = [];
      for (let i = 0; i < chunks.length; i += config.batchSize) {
        const batch = chunks.slice(i, i + config.batchSize).map((c) => prefix(config.embeddingModel, c, false));
        try { vectors.push(...await runtime.embed(config.embeddingModel, batch)); }
        catch (error) {
          if (batch.length === 1) throw error;
          // Reintenta por fragmento ante presión de memoria, sin cambiar modelo ni truncar contenido.
          for (const text of batch) vectors.push(...await runtime.embed(config.embeddingModel, [text]));
        }
      }
      await api.saveVector(doc.id, vectorSpace(config), centroid(vectors), sourceHash(doc));
      indexed++; progress(`Indexado ${indexed}: ${doc.title} (${chunks.length} fragmentos, cálculo local)`);
    }
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  return { indexed, skipped, model: config.embeddingModel, vectorSpace: vectorSpace(config), execution: "client-only" };
}

export async function semanticSearch(api: ApiClient, config: LocalModelsConfig, query: string, packageNames?: string[]) {
  if (!query.trim()) throw new Error("La consulta no puede estar vacía");
  if (Array.from(query).length > 1200) throw new Error("La consulta semántica admite hasta 1200 caracteres; haz una pregunta más concreta.");
  const runtime = await checkedRuntime(config);
  const [embedding] = await runtime.embed(config.embeddingModel, [prefix(config.embeddingModel, query, true)]);
  return api.vectorSearch(vectorSpace(config), embedding, packageNames);
}
