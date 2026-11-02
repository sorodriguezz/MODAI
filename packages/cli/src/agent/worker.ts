import type { ApiClient } from "@modai/sdk";
import { executeAgent, type RuntimeOptions } from "./runtime.js";
import { verifyBundle } from "./activation.js";
import type { SignaturePolicy } from "@modai/contracts/types";

export async function workOnce(api: ApiClient, projectId: string, options: RuntimeOptions & { signaturePolicy?: SignaturePolicy; trustedPublishers?: string[] }): Promise<boolean> {
  const claimed = await api.claimRun(projectId);
  if (!claimed) return false;
  const { run, leaseToken } = claimed;
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  let lost = false, renewing = false;
  const leaseDuration = Math.max(new Date(run.leaseExpiresAt!).getTime() - Date.now(), 100);
  const timer = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try { await api.heartbeat(run.id, leaseToken); }
    catch { lost = true; controller.abort(new Error("Se perdió el lease del worker")); }
    finally { renewing = false; }
  }, Math.max(Math.floor(leaseDuration / 3), 25));
  try {
    if (run.projectId !== projectId) throw new Error("El servidor devolvió una tarea de otro proyecto");
    await verifyBundle(api, run.bundle, { policy: options.signaturePolicy ?? "optional", trustedPublishers: options.trustedPublishers ?? [] });
    const result = await executeAgent(api, run.bundle, run.task, { ...options, signal, sessionId: run.id });
    if (!lost) await api.finishRun(run.id, leaseToken, { result });
  } catch (error) {
    if (!lost) await api.finishRun(run.id, leaseToken, { error: (error as Error).message.slice(0,10000) });
  } finally { clearInterval(timer); controller.abort(); }
  return true;
}
