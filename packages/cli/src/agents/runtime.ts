import { randomUUID } from "node:crypto";
import type { AgentBundle } from "@modai/contracts/types";
import type { ApiClient } from "@modai/sdk";
import { LocalOllama, localRuntimeUrl } from "../client/ollama.js";
import { agentInstructions } from "./bundle.js";
import { CapabilityHost, type CapabilityOptions } from "./capabilities.js";

export interface RuntimeOptions extends CapabilityOptions {
  model?: string;
  url?: string;
  maxSteps?: number;
  timeoutMs?: number;
}

type Message = Record<string, unknown>;
type ToolCall = { function: { name: string; arguments: unknown } };
type ChatMessage = { role?: string; content: string; tool_calls?: ToolCall[] };
type Chat = { url: string; model: string; tools: unknown[]; signal: AbortSignal };

async function chat(options: Chat, messages: Message[]): Promise<ChatMessage> {
  const response = await fetch(`${options.url}/api/chat`, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: options.model, messages, tools: options.tools, stream: false }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`Ollama respondió HTTP ${response.status}`);
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 2_000_000) throw new Error("La respuesta del modelo excede el límite");
  const data = JSON.parse(raw) as { message?: Partial<ChatMessage> };
  if (!data.message || typeof data.message.content !== "string") throw new Error("Respuesta de Ollama inválida");
  return data.message as ChatMessage;
}

async function toolResult(host: CapabilityHost, call: ToolCall): Promise<string> {
  let content: string;
  try {
    content = JSON.stringify(await host.call(call.function.name, call.function.arguments));
  } catch (error) {
    content = JSON.stringify({ error: (error as Error).message });
  }
  return content.length > 100_000
    ? JSON.stringify({ error: "Resultado demasiado grande; reduce el alcance de la consulta" })
    : content;
}

async function runCalls(host: CapabilityHost, calls: ToolCall[], messages: Message[], signal: AbortSignal) {
  for (const call of calls) {
    signal.throwIfAborted();
    messages.push({ role: "tool", tool_name: call.function.name, content: await toolResult(host, call) });
  }
}

async function loop(host: CapabilityHost, chatOptions: Chat, messages: Message[], maxSteps: number): Promise<string> {
  for (let step = 0; step < maxSteps; step++) {
    chatOptions.signal.throwIfAborted();
    const message = await chat(chatOptions, messages);
    const calls = message.tool_calls ?? [];
    if (!calls.length) return message.content;
    if (calls.length > 16) throw new Error("El modelo solicitó demasiadas herramientas en un paso");
    messages.push({ ...message, role: "assistant" });
    await runCalls(host, calls, messages, chatOptions.signal);
    if (JSON.stringify(messages).length > 1_000_000) throw new Error("La ejecución excedió su presupuesto de contexto");
  }
  throw new Error(`El agente alcanzó el límite de ${maxSteps} pasos`);
}

export async function executeAgent(
  api: ApiClient,
  bundle: AgentBundle,
  task: string,
  options: RuntimeOptions,
): Promise<string> {
  const model = options.model ?? bundle.agent.definition.runtime?.model;
  if (!model || /:cloud$/.test(model)) throw new Error("Selecciona un modelo local con --model");
  const allowedModels = bundle.executionPolicy?.allowedModels;
  if (allowedModels && !allowedModels.includes(model))
    throw new Error("La política del proyecto no autoriza este modelo");
  const url = localRuntimeUrl(options.url ?? "http://127.0.0.1:11434");
  await new LocalOllama(url).model(model);
  const maxSteps = Math.min(Math.max(options.maxSteps ?? 12, 1), 32);
  const deadline = AbortSignal.timeout(Math.min(options.timeoutMs ?? 600_000, 3_600_000));
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const host = new CapabilityHost(api, bundle, { ...options, signal, sessionId: options.sessionId ?? randomUUID() });
  await host.start();
  try {
    const messages: Message[] = [
      { role: "system", content: agentInstructions(bundle) },
      { role: "user", content: task },
    ];
    const tools = host.list().map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));
    return await loop(host, { url, model, tools, signal }, messages, maxSteps);
  } finally {
    await host.close();
  }
}
