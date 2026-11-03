import { AppError } from "@modai/contracts/errors";
import { type AdapterDefinition, adapterDefinitionSchema, type PackageManifestV1 } from "@modai/contracts/manifest";

export const BUILTIN_ADAPTERS: AdapterDefinition[] = [
  {
    id: "agent-skills",
    description: "Agent Skills en .agents/skills (formato abierto compartido por varios agentes).",
    targets: { skills: { path: ".agents/skills/{skill}" } },
  },
  {
    id: "agents-md",
    description: "Reglas e índice de capacidades en un bloque administrado de AGENTS.md.",
    targets: { rules: { mode: "block", file: "AGENTS.md" }, index: { mode: "block", file: "AGENTS.md" } },
  },
  {
    id: "claude-code",
    description: "Skills en .claude/skills, reglas e índice en CLAUDE.md y gateway MCP en .mcp.json.",
    targets: {
      skills: { path: ".claude/skills/{skill}" },
      rules: { mode: "block", file: "CLAUDE.md" },
      index: { mode: "block", file: "CLAUDE.md" },
      mcp: { file: ".mcp.json", pointer: "mcpServers.modai" },
    },
  },
  {
    id: "mcp",
    description: "Configuración genérica del gateway MCP de MODAI en .modai/mcp.json para cualquier cliente MCP.",
    targets: { mcp: { file: ".modai/mcp.json", pointer: "mcpServers.modai" } },
  },
].map((item) => adapterDefinitionSchema.parse(item));

export const DEFAULT_MCP_VALUE = { command: "modai-mcp", args: ["--project", "."] };

export interface AvailableAdapter {
  definition: AdapterDefinition;
  source: string;
}

export function availableAdapters(packages: Array<{ name: string; manifest: PackageManifestV1 }>): AvailableAdapter[] {
  const result: AvailableAdapter[] = BUILTIN_ADAPTERS.map((definition) => ({ definition, source: "builtin" }));
  for (const item of packages) {
    const definition = item.manifest.spec.adapter;
    if (!definition) continue;
    const existing = result.find((adapter) => adapter.definition.id === definition.id);
    if (existing)
      throw new AppError(
        409,
        "ADAPTER_COLLISION",
        `El adaptador ${definition.id} de ${item.name} colisiona con ${existing.source}`,
      );
    result.push({ definition, source: item.name });
  }
  return result;
}

export function selectAdapters(ids: string[], available: AvailableAdapter[]): AvailableAdapter[] {
  return ids.map((id) => {
    const adapter = available.find((item) => item.definition.id === id);
    if (!adapter)
      throw new AppError(
        404,
        "ADAPTER_NOT_FOUND",
        `Adaptador desconocido: ${id}. Disponibles: ${available.map((item) => item.definition.id).join(", ")}. Un adaptador nuevo se instala como paquete (kind: Adapter).`,
      );
    return adapter;
  });
}
