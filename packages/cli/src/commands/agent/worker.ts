import { setTimeout as delay } from "node:timers/promises";
import { signaturePolicySchema } from "@modai/contracts/schemas";
import type { ApiClient } from "@modai/sdk";
import type { Command } from "commander";
import { type ExecutionFlags, runtimeOptions } from "../../agents/runtime-options.js";
import { workOnce } from "../../agents/worker.js";
import { loadClientConfig } from "../../services/config.js";
import { serverApi } from "../../services/connection.js";
import { strictestPolicy } from "../../services/trust.js";
import type { Print } from "../../terminal/output.js";
import { withExecutionOptions } from "./run.js";

type WorkerFlags = ExecutionFlags & { project: string; once?: boolean; signaturePolicy: string };

async function workLoop(api: ApiClient, options: WorkerFlags, print: Print, signal: AbortSignal): Promise<void> {
  const config = loadClientConfig();
  const requested = signaturePolicySchema.parse(options.signaturePolicy);
  const info = await api.health();
  const policy = strictestPolicy(requested, config?.signaturePolicy, info.signaturePolicy);
  do {
    const worked = await workOnce(api, options.project, {
      ...runtimeOptions(options),
      signal,
      signaturePolicy: policy,
      trustedPublishers: config?.trustedPublishers ?? [],
    });
    if (options.once) {
      print({ processed: worked });
      break;
    }
    if (!worked) await delay(2000, undefined, { signal });
  } while (!signal.aborted);
}

export function registerAgentWorker(agent: Command, print: Print): void {
  withExecutionOptions(
    agent.command("worker").description("Procesa en este equipo las tareas encoladas de un proyecto del servidor"),
  )
    .requiredOption("--project <id>")
    .option("--once", "Procesa una tarea y termina")
    .option("--signature-policy <policy>", "optional, signed o trusted", "trusted")
    .action(async (options: WorkerFlags) => {
      const api = serverApi();
      await api.assertCompatible();
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        await workLoop(api, options, print, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    });
}
