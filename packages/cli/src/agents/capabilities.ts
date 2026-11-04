import { sha256 } from "@modai/contracts/security";
import type { AgentBundle, AgentCapability } from "@modai/contracts/types";
import { loadV1Project, resolveCommand, storePackageDir, verifyStore } from "@modai/core";
import type { ApiClient } from "@modai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Ajv, type ValidateFunction } from "ajv";
import { invokeBuiltin } from "./builtin-tools.js";

export interface ToolDescription {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface CapabilityOptions {
  cwd: string;
  allowedMcp?: string[];
  allowedEnv?: string[];
  sessionId?: string;
  signal?: AbortSignal;
}
type McpCapability = Extract<AgentCapability, { kind: "mcp" }>;
type ToolCall = (input: Record<string, unknown>) => Promise<unknown>;

// biome-ignore lint/suspicious/noTemplateCurlyInString: placeholder the Core expands at run time
const PACKAGE_DIR = "${packageDir}";

const toolName = (capability: string, tool: string) => {
  const fullName = `${capability}__${tool}`;
  return fullName.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(fullName)
    ? fullName
    : `${capability}__${sha256(tool).slice(0, 12)}`;
};

export class CapabilityHost {
  private readonly clients: Client[] = [];
  private readonly tools = new Map<
    string,
    { description: ToolDescription; validate: ValidateFunction; call: ToolCall }
  >();
  private readonly ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  constructor(
    private readonly api: ApiClient,
    private readonly bundle: AgentBundle,
    private readonly options: CapabilityOptions,
  ) {}

  async start(): Promise<void> {
    try {
      for (const capability of this.bundle.capabilities) {
        if (capability.kind === "builtin")
          this.register(
            { name: capability.name, description: capability.description, inputSchema: capability.inputSchema },
            (input) => invokeBuiltin(this.api, this.bundle, this.options.sessionId, capability.name, input),
          );
        else await this.connect(capability);
      }
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private environment(capability: McpCapability): Record<string, string> {
    if (!this.options.allowedMcp?.includes(capability.name))
      throw new Error(`Proceso MCP no autorizado: ${capability.name}`);
    const env = getDefaultEnvironment();
    for (const name of capability.envKeys) {
      if (!this.options.allowedEnv?.includes(name)) throw new Error(`Variable no autorizada para MCP: ${name}`);
      if (process.env[name] !== undefined) env[name] = process.env[name]!;
    }
    return env;
  }

  private async connect(capability: McpCapability): Promise<void> {
    const env = this.environment(capability);
    const client = new Client({ name: "modai-capabilities", version: "0.10.0" });
    this.clients.push(client);
    const transport = new StdioClientTransport({
      ...this.launch(capability),
      env,
      cwd: this.options.cwd,
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => {});
    await client.connect(transport);
    await this.registerRemoteTools(client, capability);
  }

  private async registerRemoteTools(client: Client, capability: McpCapability): Promise<void> {
    let cursor: string | undefined;
    let count = 0,
      pages = 0;
    do {
      if (++pages > 10) throw new Error("Demasiadas páginas de herramientas MCP");
      const page = await client.listTools({ cursor });
      for (const tool of page.tools) {
        if (++count > 100) throw new Error("El proceso MCP excede 100 herramientas");
        this.register(
          {
            name: toolName(capability.name, tool.name),
            description: `${capability.description}: ${tool.description ?? tool.name}`,
            inputSchema: tool.inputSchema,
          },
          (input) => client.callTool({ name: tool.name, arguments: input }),
        );
      }
      cursor = page.nextCursor;
    } while (cursor);
  }

  private register(description: ToolDescription, call: ToolCall): void {
    if (this.tools.has(description.name)) throw new Error(`Colisión de herramientas: ${description.name}`);
    if (JSON.stringify(description.inputSchema).length > 32_000)
      throw new Error("Esquema de herramienta demasiado grande");
    this.tools.set(description.name, { description, call, validate: this.ajv.compile(description.inputSchema) });
  }

  list(): ToolDescription[] {
    return [...this.tools.values()].map((tool) => tool.description);
  }

  async call(name: string, input: unknown): Promise<unknown> {
    this.options.signal?.throwIfAborted();
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Herramienta no habilitada: ${name}`);
    if (JSON.stringify(input).length > 64_000 || !tool.validate(input))
      throw new Error(`Entrada inválida para ${name}: ${this.ajv.errorsText(tool.validate.errors)}`);
    return tool.call(input as Record<string, unknown>);
  }

  private launch(capability: McpCapability): { command: string; args: string[] } {
    const { cwd } = this.options;
    let packageDir = cwd;
    if ([capability.command, ...capability.args].some((value) => value.includes(PACKAGE_DIR))) {
      const locked = loadV1Project(cwd).lock.packages[capability.package];
      if (!locked || !verifyStore(cwd, capability.package, locked.integrity))
        throw new Error(
          `${capability.package} no está instalado o su contenido cambió desde modai.lock; ejecuta modai sync`,
        );
      packageDir = storePackageDir(cwd, capability.package);
    }
    return resolveCommand(capability.command, capability.args, packageDir, cwd);
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.clients.map((client) => client.close()));
    this.clients.length = 0;
  }
}
