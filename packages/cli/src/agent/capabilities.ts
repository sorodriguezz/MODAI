import { Ajv, type ValidateFunction } from "ajv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { AgentBundle, AgentCapability } from "@modai/contracts/types";
import { loadV1Project, resolveCommand, storePackageDir, verifyStore } from "@modai/core";
import { sha256 } from "@modai/contracts/security";
import type { ApiClient } from "@modai/sdk";

export interface ToolDescription { name: string; description: string; inputSchema: Record<string, unknown> }
export interface CapabilityOptions { cwd: string; allowedMcp?: string[]; allowedEnv?: string[]; sessionId?: string; signal?: AbortSignal }
export class CapabilityHost {
  private readonly clients: Client[] = [];
  private readonly tools = new Map<string, { description: ToolDescription; validate: ValidateFunction; call: (input: Record<string, unknown>) => Promise<unknown> }>();
  private readonly ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  constructor(private readonly api: ApiClient, private readonly bundle: AgentBundle, private readonly options: CapabilityOptions) {}

  async start(): Promise<void> {
    try {
      for (const capability of this.bundle.capabilities) {
        if (capability.kind === "builtin") {
          this.register({ name: capability.name, description: capability.description, inputSchema: capability.inputSchema }, input => this.invokeBuiltin(capability.name, input));
        } else {
          if (!this.options.allowedMcp?.includes(capability.name)) throw new Error(`Proceso MCP no autorizado: ${capability.name}`);
          const env = getDefaultEnvironment();
          for (const name of capability.envKeys) {
            if (!this.options.allowedEnv?.includes(name)) throw new Error(`Variable no autorizada para MCP: ${name}`);
            if (process.env[name] !== undefined) env[name] = process.env[name]!;
          }
          const client = new Client({ name: "modai-capabilities", version: "0.9.0" });
          this.clients.push(client);
          const transport = new StdioClientTransport({ ...this.launch(capability), env, cwd: this.options.cwd, stderr: "pipe" });
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
  private async invokeBuiltin(name: string, input: Record<string, unknown>): Promise<unknown> {
    const query = () => { if (typeof input.query !== "string" || !input.query.trim()) throw new Error("query es obligatorio"); return input.query; };
    if (name === "modai_search_knowledge") return this.api.searchKnowledge(query(), this.bundle.packages.map(item => item.name));
    if (name === "modai_recall") {
      const scopes = this.bundle.agent.definition.memory.read;
      if (!scopes.length) return [];
      const memories = await this.api.recall(this.bundle.projectId, query(), { includeOrganization: scopes.includes("organization"), sessionId: scopes.includes("session") ? this.options.sessionId : undefined });
      return memories.filter(memory => scopes.includes((memory as { scope: "project" | "organization" | "session" }).scope));
    }
    if (name === "modai_remember") {
      if (!this.bundle.agent.definition.memory.write) throw new Error("La política del agente impide escribir memoria");
      if (typeof input.content !== "string" || !input.content.trim()) throw new Error("content es obligatorio");
      return this.api.remember({ projectId: this.bundle.projectId, content: input.content, kind: typeof input.kind === "string" ? input.kind : "note", scope: "project" });
    }
    throw new Error(`Herramienta integrada desconocida: ${name}`);
  }
  /** MCP servers reference package files with ${packageDir}; those run only from a store that still matches modai.lock. */
  private launch(capability: Extract<AgentCapability, { kind: "mcp" }>): { command: string; args: string[] } {
    const { cwd } = this.options;
    let packageDir = cwd;
    if ([capability.command, ...capability.args].some(value => value.includes("${packageDir}"))) {
      const locked = loadV1Project(cwd).lock.packages[capability.package];
      if (!locked || !verifyStore(cwd, capability.package, locked.integrity)) throw new Error(`${capability.package} no está instalado o su contenido cambió desde modai.lock; ejecuta modai sync`);
      packageDir = storePackageDir(cwd, capability.package);
    }
    return resolveCommand(capability.command, capability.args, packageDir, cwd);
  }
  async close(): Promise<void> { await Promise.allSettled(this.clients.map(client => client.close())); this.clients.length = 0; }
}
