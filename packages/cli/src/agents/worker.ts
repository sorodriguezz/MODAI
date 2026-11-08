import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBundle, ArtifactFile, SignaturePolicy } from "@modai/contracts/types";
import { computeIntegrity, writeStore } from "@modai/core";
import type { ApiClient } from "@modai/sdk";
import { verifyBundle } from "./bundle.js";
import { executeAgent, type RuntimeOptions } from "./runtime.js";

function storeVerifiedTools(root: string, bundle: AgentBundle, filesByName: Map<string, ArtifactFile[]>) {
  const integrity = new Map<string, string>();
  for (const { name, version, manifest } of bundle.packages) {
    const files = filesByName.get(name);
    if (!files) continue;
    const hash = computeIntegrity(manifest, files);
    writeStore(root, { name, version, manifest, files, integrity: hash });
    integrity.set(name, hash);
  }
  return { root, integrity };
}

async function executeClaimed(
  api: ApiClient,
  bundle: AgentBundle,
  task: string,
  options: RuntimeOptions,
  tools: Map<string, ArtifactFile[]>,
) {
  if (!tools.size) return executeAgent(api, bundle, task, options);
  const root = mkdtempSync(join(tmpdir(), "modai-worker-"));
  try {
    return await executeAgent(api, bundle, task, { ...options, bundleStore: storeVerifiedTools(root, bundle, tools) });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export async function workOnce(
  api: ApiClient,
  projectId: string,
  options: RuntimeOptions & { signaturePolicy?: SignaturePolicy; trustedPublishers?: string[] },
): Promise<boolean> {
  const claimed = await api.claimRun(projectId, { model: options.model, mcp: options.allowedMcp });
  if (!claimed) return false;
  const { run, leaseToken } = claimed;
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  let lost = false,
    renewing = false;
  const leaseDuration = Math.max(new Date(run.leaseExpiresAt!).getTime() - Date.now(), 100);
  const timer = setInterval(
    async () => {
      if (renewing) return;
      renewing = true;
      try {
        await api.heartbeat(run.id, leaseToken);
      } catch {
        lost = true;
        controller.abort(new Error("Se perdió el lease del worker"));
      } finally {
        renewing = false;
      }
    },
    Math.max(Math.floor(leaseDuration / 3), 25),
  );
  try {
    if (run.projectId !== projectId) throw new Error("El servidor devolvió una tarea de otro proyecto");
    const tools = await verifyBundle(api, run.bundle, {
      policy: options.signaturePolicy ?? "optional",
      trustedPublishers: options.trustedPublishers ?? [],
    });
    const result = await executeClaimed(api, run.bundle, run.task, { ...options, signal, sessionId: run.id }, tools);
    if (!lost) await api.finishRun(run.id, leaseToken, { result });
  } catch (error) {
    if (!lost) await api.finishRun(run.id, leaseToken, { error: (error as Error).message.slice(0, 10000) });
  } finally {
    clearInterval(timer);
    controller.abort();
  }
  return true;
}
