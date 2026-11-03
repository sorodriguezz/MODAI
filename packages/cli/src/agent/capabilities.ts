import { spawn } from "node:child_process";
import { Ajv, type ValidateFunction } from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentBundle, RunnerBinding } from "@modai/contracts/types";
import { sha256 } from "@modai/contracts/security";
import type { ApiClient } from "@modai/sdk";

export interface ToolDescription { name: string; description: string; inputSchema: Record<string, unknown> }
export interface CapabilityOptions { cwd: string; allowedTools?: string[]; allowedMcp?: string[]; allowedEnv?: string[]; bindings?: Record<string, RunnerBinding>; sessionId?: string; signal?: AbortSignal }
export class CapabilityHost {
  private readonly clients: Client[] = [];
  private readonly tools = new Map<string, { description: ToolDescription; validate: ValidateFunction; call: (input: Record<string, unknown>) => Promise<unknown> }>();
  private readonly ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  constructor(private readonly api: ApiClient, private readonly bundle: AgentBundle, private readonly options: CapabilityOptions) {}

  async start(): Promise<void> {
    try {
      for (const capability of this.bundle.capabilities) {
        if (capability.kind === "tool") {
          if (capability.binding.startsWith("local:") && !this.options.allowedTools?.includes(capability.name)) throw new Error(`Herramienta local no autorizada: ${capability.name}`);
          this.register(capability, input => this.invokeBinding(capability.binding, input));
        } else {
          if (!this.options.allowedMcp?.includes(capability.name)) throw new Error(`Proceso MCP no autorizado: ${capability.name}`);
          const env = getDefaultEnvironment();
          for (const name of capability.envKeys) {
            if (!this.options.allowedEnv?.includes(name)) throw new Error(`Variable no autorizada para MCP: ${name}`);
            if (process.env[name] !== undefined) env[name] = process.env[name]!;
          }
          const client = new Client({ name: "modai-capabilities", version: "0.8.0" });
          this.clients.push(client);
          const transport = new StdioClientTransport({ command: capability.command, args: capability.args, env, cwd: this.options.cwd, stderr: "pipe" });
          transport.stderr?.on("data", () => {});
          await client.connect(transport);
          let cursor: string | undefined;
          let count = 0, pages = 0;
          do {
            if (++pages > 10) throw new Error("Demasiadas páginas de herramientas MCP");
            const page = await client.listTools({ cursor });
            for (const tool of page.tools) {
              if (++count > 100) throw new Error("El proceso MCP excede 100 herramientas");
              const fullName = `${capability.name}__${tool.name}`;
              const name = fullName.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(fullName) ? fullName : `${capability.name}__${sha256(tool.name).slice(0,12)}`;
              this.register({ name, description: `${capability.description}: ${tool.description ?? tool.name}`, inputSchema: tool.inputSchema }, input => client.callTool({ name: tool.name, arguments: input }));
            }
            cursor = page.nextCursor;
          } while (cursor);
        }
      }
    } catch (error) { await this.close(); throw error; }
  }
  private register(description: ToolDescription, call: (input: Record<string, unknown>) => Promise<unknown>): void {
    if (this.tools.has(description.name)) throw new Error(`Colisión de herramientas: ${description.name}`);
    if (JSON.stringify(description.inputSchema).length > 32_000) throw new Error("Esquema de herramienta demasiado grande");
    this.tools.set(description.name, { description, call, validate: this.ajv.compile(description.inputSchema) });
  }
  list(): ToolDescription[] { return [...this.tools.values()].map(tool => tool.description); }
  async call(name: string, input: unknown): Promise<unknown> {
    this.options.signal?.throwIfAborted();
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Herramienta no habilitada: ${name}`);
    if (JSON.stringify(input).length > 64_000 || !tool.validate(input)) throw new Error(`Entrada inválida para ${name}: ${this.ajv.errorsText(tool.validate.errors)}`);
    return tool.call(input as Record<string, unknown>);
  }
  private async invokeBinding(binding: string, input: Record<string, unknown>): Promise<unknown> {
    const query = () => { if (typeof input.query !== "string" || !input.query.trim()) throw new Error("query es obligatorio"); return input.query; };
    if (binding === "knowledge.search") return this.api.searchKnowledge(query(), this.bundle.packages.map(item => item.name));
    if (binding === "packages.list") return this.bundle.packages.map(({ name, version, type, description }) => ({ name, version, type, description }));
    if (binding === "memory.recall") {
      const scopes = this.bundle.agent.definition.memory.read;
      if (!scopes.length) return [];
      const memories = await this.api.recall(this.bundle.projectId, query(), { includeOrganization: scopes.includes("organization"), sessionId: scopes.includes("session") ? this.options.sessionId : undefined });
      return memories.filter(memory => scopes.includes((memory as { scope: "project" | "organization" | "session" }).scope));
    }
    if (binding === "memory.remember") {
      if (!this.bundle.agent.definition.memory.write) throw new Error("La política del agente impide escribir memoria");
      if (typeof input.content !== "string" || !input.content.trim()) throw new Error("content es obligatorio");
      return this.api.remember({ projectId: this.bundle.projectId, content: input.content, kind: typeof input.kind === "string" ? input.kind : "note", scope: "project" });
    }
    if (!binding.startsWith("local:")) throw new Error(`Binding no soportado: ${binding}`);
    const runner = this.options.bindings?.[binding.slice(6)];
    if (!runner) throw new Error(`Configura el ejecutor local ${binding} en tu archivo de bindings`);
    const env = getDefaultEnvironment();
    for (const name of runner.envKeys ?? []) {
      if (!this.options.allowedEnv?.includes(name)) throw new Error(`Variable no autorizada: ${name}`);
      if (process.env[name] !== undefined) env[name] = process.env[name]!;
    }
    return new Promise<string>((resolve, reject) => {
      const child = spawn(runner.command, runner.args, { cwd: this.options.cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"], signal: this.options.signal });
      let stdout = "", stderr = "", bytes = 0;
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("La herramienta excedió su tiempo máximo")); }, Math.min(runner.timeoutMs ?? 30_000, 120_000));
      const collect = (chunk: Buffer, error = false) => {
        bytes += chunk.length;
        if (bytes > 1_000_000) { child.kill("SIGKILL"); reject(new Error("La herramienta excedió su límite de salida")); }
        else if (error) stderr += chunk.toString(); else stdout += chunk.toString();
      };
      child.stdout.on("data", chunk => collect(chunk)); child.stderr.on("data", chunk => collect(chunk, true));
      child.on("error", error => { clearTimeout(timeout); reject(error); });
      child.on("close", code => { clearTimeout(timeout); if (code === 0) resolve(stdout); else reject(new Error(`La herramienta terminó con código ${code}: ${stderr.slice(0,2000)}`)); });
      child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify(input));
    });
  }
  async close(): Promise<void> { await Promise.allSettled(this.clients.map(client => client.close())); this.clients.length = 0; }
}
