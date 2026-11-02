import { randomUUID } from "node:crypto";
import type { AgentBundle } from "@modai/contracts/types";
import type { ApiClient } from "@modai/sdk";
import { LocalOllama, localRuntimeUrl } from "../client/ollama.js";
import { agentInstructions } from "./activation.js";
import { CapabilityHost, type CapabilityOptions } from "./capabilities.js";

export interface RuntimeOptions extends CapabilityOptions { model?: string; url?: string; maxSteps?: number; timeoutMs?: number }
export async function executeAgent(api: ApiClient, bundle: AgentBundle, task: string, options: RuntimeOptions): Promise<string> {
  const model = options.model ?? bundle.agent.definition.runtime?.model;
  if (!model || /:cloud$/.test(model)) throw new Error("Selecciona un modelo local con --model");
  const url = localRuntimeUrl(options.url ?? "http://127.0.0.1:11434");
  await new LocalOllama(url).model(model);
  const maxSteps = Math.min(Math.max(options.maxSteps ?? 12, 1), 32);
  const deadline = AbortSignal.timeout(Math.min(options.timeoutMs ?? 600_000, 3_600_000));
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const host = new CapabilityHost(api, bundle, { ...options, signal, sessionId: options.sessionId ?? randomUUID() });
  await host.start();
  try {
    const messages: Array<Record<string, unknown>> = [{ role: "system", content: agentInstructions(bundle) }, { role: "user", content: task }];
    const tools = host.list().map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
    for (let step = 0; step < maxSteps; step++) {
      signal.throwIfAborted();
      const response = await fetch(`${url}/api/chat`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages, tools, stream: false }), signal });
      if (!response.ok) throw new Error(`Ollama respondió HTTP ${response.status}`);
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 2_000_000) throw new Error("La respuesta del modelo excede el límite");
      const data = JSON.parse(raw) as { message?: { role?: string; content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> } };
      if (!data.message || typeof data.message.content !== "string") throw new Error("Respuesta de Ollama inválida");
      const calls = data.message.tool_calls ?? [];
      if (!calls.length) return data.message.content;
      if (calls.length > 16) throw new Error("El modelo solicitó demasiadas herramientas en un paso");
      messages.push({ ...data.message, role: "assistant" });
      for (const call of calls) {
        signal.throwIfAborted();
        let content: string;
        try { content = JSON.stringify(await host.call(call.function.name, call.function.arguments)); }
        catch (error) { content = JSON.stringify({ error: (error as Error).message }); }
        if (content.length > 100_000) content = JSON.stringify({ error: "Resultado demasiado grande; reduce el alcance de la consulta" });
        messages.push({ role: "tool", tool_name: call.function.name, content });
      }
      if (JSON.stringify(messages).length > 1_000_000) throw new Error("La ejecución excedió su presupuesto de contexto");
    }
    throw new Error(`El agente alcanzó el límite de ${maxSteps} pasos`);
  } finally { await host.close(); }
}
