import { AppError } from "@modai/contracts/errors";
import { requiredTargetPermission } from "@modai/contracts/security";
import { adapterDefinitionSchema, type AdapterDefinition, type PackageManifestV1 } from "@modai/contracts/spec-v1";
import { adapterTargetPermission, assertWritableTarget, componentTargetPermission, expandTemplate } from "./targets.js";
import { componentFiles, skillFiles } from "./validate.js";

/**
 * Built-in adapters are plain data with exactly the same schema as an Adapter package.
 * The installer has no agent-specific code: supporting a new agent means publishing a
 * package with `kind: Adapter`, never changing the Core.
 */
export const BUILTIN_ADAPTERS: AdapterDefinition[] = [
  { id: "agent-skills", description: "Agent Skills en .agents/skills (formato abierto compartido por varios agentes).", targets: { skills: { path: ".agents/skills/{skill}" } } },
  { id: "agents-md", description: "Reglas e índice de capacidades en un bloque administrado de AGENTS.md.", targets: { rules: { mode: "block", file: "AGENTS.md" }, index: { mode: "block", file: "AGENTS.md" } } },
  { id: "claude-code", description: "Skills en .claude/skills, reglas e índice en CLAUDE.md y gateway MCP en .mcp.json.", targets: { skills: { path: ".claude/skills/{skill}" }, rules: { mode: "block", file: "CLAUDE.md" }, index: { mode: "block", file: "CLAUDE.md" }, mcp: { file: ".mcp.json", pointer: "mcpServers.modai" } } },
  { id: "mcp", description: "Configuración genérica del gateway MCP de MODAI en .modai/mcp.json para cualquier cliente MCP.", targets: { mcp: { file: ".modai/mcp.json", pointer: "mcpServers.modai" } } },
].map(item => adapterDefinitionSchema.parse(item));

export const DEFAULT_MCP_VALUE = { command: "modai-mcp", args: ["--project", "."] };

export interface AvailableAdapter { definition: AdapterDefinition; source: string }

export function availableAdapters(packages: Array<{ name: string; manifest: PackageManifestV1 }>): AvailableAdapter[] {
  const result: AvailableAdapter[] = BUILTIN_ADAPTERS.map(definition => ({ definition, source: "builtin" }));
  for (const item of packages) {
    const definition = item.manifest.spec.adapter;
    if (!definition) continue;
    const existing = result.find(adapter => adapter.definition.id === definition.id);
    if (existing) throw new AppError(409, "ADAPTER_COLLISION", `El adaptador ${definition.id} de ${item.name} colisiona con ${existing.source}`);
    result.push({ definition, source: item.name });
  }
  return result;
}

export function selectAdapters(ids: string[], available: AvailableAdapter[]): AvailableAdapter[] {
  return ids.map(id => {
    const adapter = available.find(item => item.definition.id === id);
    if (!adapter) throw new AppError(404, "ADAPTER_NOT_FOUND", `Adaptador desconocido: ${id}. Disponibles: ${available.map(item => item.definition.id).join(", ")}. Un adaptador nuevo se instala como paquete (kind: Adapter).`);
    return adapter;
  });
}

export interface InstallUnit { name: string; version: string; manifest: PackageManifestV1; files: Map<string, Buffer> }
export interface DesiredFile { path: string; content: Buffer; owner: string; adapter?: string; executable: boolean; permission?: string }
export interface DesiredBlock { path: string; id: string; content: string; owners: string[]; adapter: string; permission?: string }
export interface DesiredJson { path: string; pointer: string; value: unknown; adapter: string; permission?: string }
export interface DesiredState { files: DesiredFile[]; blocks: DesiredBlock[]; json: DesiredJson[] }

function frontmatterDescription(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = match?.[1].split(/\r?\n/).find(item => item.startsWith("description:"));
  return line?.slice("description:".length).trim().replace(/^["']|["']$/g, "").slice(0, 300);
}

/** Translates every contribution of every package into files, managed blocks and JSON entries for the active adapters. */
export function planContributions(units: InstallUnit[], adapters: AvailableAdapter[]): DesiredState {
  const files = new Map<string, DesiredFile>();
  const blocks = new Map<string, DesiredBlock>();
  const json = new Map<string, DesiredJson>();
  const addFile = (file: DesiredFile) => {
    const key = file.path.toLowerCase();
    const existing = files.get(key);
    if (existing && (existing.owner !== file.owner || !existing.content.equals(file.content))) throw new AppError(409, "TARGET_COLLISION", `Colisión: ${existing.owner} y ${file.owner} administran ${file.path}`);
    files.set(key, file);
  };
  const addBlock = (block: DesiredBlock) => {
    const key = `${block.path.toLowerCase()}#${block.id}`;
    const existing = blocks.get(key);
    if (existing) {
      if (existing.content !== block.content) throw new AppError(409, "TARGET_COLLISION", `Los adaptadores ${existing.adapter} y ${block.adapter} escriben bloques distintos en ${block.path}`);
      return;
    }
    blocks.set(key, block);
  };
  const rulesByBlock = new Map<string, { adapter: string; sections: string[]; owners: Set<string> }>();
  const skillLocation = new Map<string, string>();
  const skillAdapter = adapters.find(adapter => adapter.definition.targets.skills);

  for (const unit of units) {
    const { contributes } = unit.manifest.spec;
    for (const rule of contributes.files) {
      const path = assertWritableTarget(rule.target);
      const permission = requiredTargetPermission(path);
      addFile({ path, content: unit.files.get(rule.source)!, owner: unit.name, executable: Boolean(rule.executable), permission });
    }
    for (const component of contributes.components) {
      for (const entry of componentFiles(component, unit.name, unit.files.keys())) {
        addFile({ path: assertWritableTarget(entry.target), content: unit.files.get(entry.source)!, owner: unit.name, executable: false, permission: componentTargetPermission(entry.target) });
      }
    }
    for (const skill of contributes.skills) {
      for (const adapter of adapters) {
        const template = adapter.definition.targets.skills?.path;
        if (!template) continue;
        const directory = expandTemplate(template, { skill: skill.name, package: unit.name });
        if (adapter === skillAdapter) skillLocation.set(`${unit.name}:${skill.name}`, `${directory}/SKILL.md`);
        for (const entry of skillFiles(skill, unit.files.keys())) {
          const path = `${directory}/${entry.relative}`;
          addFile({ path: assertWritableTarget(path), content: unit.files.get(entry.source)!, owner: unit.name, adapter: adapter.definition.id, executable: false, permission: adapterTargetPermission(path) });
        }
      }
    }
    for (const rule of contributes.rules) {
      const content = unit.files.get(rule.path)!.toString("utf8").trim();
      for (const adapter of adapters) {
        const target = adapter.definition.targets.rules;
        if (!target) continue;
        if (target.mode === "file") {
          const path = expandTemplate(target.path, { package: unit.name, rule: rule.name });
          addFile({ path: assertWritableTarget(path), content: Buffer.from(`${target.header ? `${target.header.replaceAll("{description}", rule.description ?? rule.name)}\n` : ""}${content}\n`), owner: unit.name, adapter: adapter.definition.id, executable: false, permission: adapterTargetPermission(path) });
        } else {
          const key = assertWritableTarget(target.file);
          const entry = rulesByBlock.get(key) ?? { adapter: adapter.definition.id, sections: [], owners: new Set<string>() };
          entry.sections.push(`### ${rule.name} · ${unit.name}\n\n${content}`);
          entry.owners.add(unit.name);
          rulesByBlock.set(key, entry);
        }
      }
    }
  }
  for (const [path, entry] of rulesByBlock) {
    addBlock({ path, id: "rules", adapter: entry.adapter, owners: [...entry.owners].sort(), permission: adapterTargetPermission(path),
      content: `## Reglas instaladas por MODAI\n\n${entry.sections.join("\n\n")}` });
  }

  const index = renderIndex(units, skillLocation);
  for (const adapter of adapters) {
    const { index: indexTarget, mcp } = adapter.definition.targets;
    if (indexTarget && index) addBlock({ path: assertWritableTarget(indexTarget.file), id: "index", content: index, owners: units.map(unit => unit.name), adapter: adapter.definition.id, permission: adapterTargetPermission(indexTarget.file) });
    if (mcp) {
      const path = assertWritableTarget(mcp.file);
      const key = `${path.toLowerCase()}#${mcp.pointer}`;
      if (!json.has(key)) json.set(key, { path, pointer: mcp.pointer, value: mcp.value ?? DEFAULT_MCP_VALUE, adapter: adapter.definition.id, permission: adapterTargetPermission(path) });
    }
  }
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  return { files: [...files.values()].sort(byPath), blocks: [...blocks.values()].sort(byPath), json: [...json.values()].sort(byPath) };
}

function renderIndex(units: InstallUnit[], skillLocation: Map<string, string>): string | undefined {
  const skills: string[] = [], tools: string[] = [], knowledge: string[] = [], capabilities: string[] = [], components: string[] = [];
  for (const unit of units) {
    const { contributes, provides } = unit.manifest.spec;
    for (const skill of contributes.skills) {
      const entry = skillFiles(skill, unit.files.keys()).find(item => item.relative === "SKILL.md");
      const description = entry ? frontmatterDescription(unit.files.get(entry.source)!.toString("utf8")) : undefined;
      const location = skillLocation.get(`${unit.name}:${skill.name}`) ?? `recurso MCP modai://skills/${skill.name}`;
      skills.push(`- \`${skill.name}\` (${unit.name}) — ${description ?? "ver SKILL.md"} → ${location}`);
    }
    for (const tool of contributes.tools) tools.push(`- \`${tool.name}\` (${unit.name})${tool.implements ? ` implementa \`${tool.implements}\`` : ""} — ${tool.description}`);
    for (const component of contributes.components) {
      const directory = expandTemplate(component.target, { component: component.name, package: unit.name });
      components.push(`- \`${component.name}\` (${unit.name})${component.description ? ` — ${component.description}` : ""} → \`${directory}\``);
    }
    if (contributes.knowledge.length) knowledge.push(`${unit.name} (${contributes.knowledge.length})`);
    for (const capability of provides) capabilities.push(`\`${capability.capability}@${capability.version}\` ← ${unit.name}`);
  }
  if (!skills.length && !tools.length && !knowledge.length && !capabilities.length && !components.length) return undefined;
  const sections = ["## Capacidades MODAI", "Bloque generado por `modai sync` a partir de modai.yaml y modai.lock; no lo edites a mano."];
  if (skills.length) sections.push(`### Skills (cárgalas solo cuando la tarea lo requiera)\n\n${skills.join("\n")}`);
  if (tools.length) sections.push(`### Herramientas (servidor MCP \`modai\`; requieren \`modai permissions grant\` en este equipo)\n\n${tools.join("\n")}`);
  if (components.length) sections.push(`### Componentes de código (instalados en el proyecto; adáptalos libremente, MODAI conserva tus cambios)\n\n${components.join("\n")}`);
  if (knowledge.length) sections.push(`### Conocimiento\n\nUsa \`modai_search_knowledge\` para recuperar fragmentos relevantes en lugar de cargar documentos completos. Fuentes: ${knowledge.join(", ")}.`);
  if (capabilities.length) sections.push(`### Capacidades disponibles\n\n${capabilities.join("\n")}`);
  return sections.join("\n\n");
}
