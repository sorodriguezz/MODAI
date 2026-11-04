import { Worker } from "node:worker_threads";
import { AppError } from "@modai/contracts/errors";
export interface VectorCandidate {
  id: string;
  vector: Uint8Array;
}
export function rankVectors(
  candidates: VectorCandidate[],
  query: number[],
  limit: number,
): Array<{ id: string; score: number }> {
  const norm = Math.hypot(...query) || 1;
  const top: Array<{ id: string; score: number }> = [];
  for (const candidate of candidates) {
    const view = new DataView(candidate.vector.buffer, candidate.vector.byteOffset, candidate.vector.byteLength);
    let score = 0;
    for (let i = 0; i < query.length; i++) score += (view.getFloat32(i * 4, true) * query[i]) / norm;
    top.push({ id: candidate.id, score });
    top.sort((a, b) => b.score - a.score);
    if (top.length > limit) top.pop();
  }
  return top;
}
let activeWorkers = 0;
export async function rankInWorker(candidates: VectorCandidate[], query: number[], limit: number) {
  if (activeWorkers >= 2) throw new AppError(429, "VECTOR_BUSY", "La búsqueda vectorial está ocupada; reintenta");
  activeWorkers++;
  try {
    return await new Promise<Array<{ id: string; score: number }>>((resolve, reject) => {
      const worker = new Worker(
        `const {parentPort,workerData}=require('node:worker_threads');parentPort.postMessage((${rankVectors.toString()})(...workerData));`,
        { eval: true, workerData: [candidates, query, limit], resourceLimits: { maxOldGenerationSizeMb: 64 } },
      );
      const timeout = setTimeout(() => {
        void worker.terminate();
        reject(new AppError(503, "VECTOR_TIMEOUT", "La búsqueda excedió su tiempo máximo"));
      }, 5000);
      worker.once("message", (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
      worker.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      worker.once("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(`Vector worker terminó: ${code}`));
      });
    });
  } finally {
    activeWorkers--;
  }
}
