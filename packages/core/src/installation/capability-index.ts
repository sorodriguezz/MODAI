import { skillFiles } from "../packages/contribution-files.js";
import type { InstallUnit } from "./desired-state.js";
import { expandTemplate } from "./targets.js";

interface IndexSections {
  skills: string[];
  tools: string[];
  knowledge: string[];
  capabilities: string[];
  components: string[];
}

function frontmatterDescription(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = match?.[1].split(/\r?\n/).find((item) => item.startsWith("description:"));
  return line
    ?.slice("description:".length)
    .trim()
    .replace(/^["']|["']$/g, "")
    .slice(0, 300);
}

function collectUnit(unit: InstallUnit, skillLocation: Map<string, string>, sections: IndexSections): void {
  const { contributes, provides } = unit.manifest.spec;
  for (const skill of contributes.skills) {
    const entry = skillFiles(skill, unit.files.keys()).find((item) => item.relative === "SKILL.md");
    const description = entry ? frontmatterDescription(unit.files.get(entry.source)!.toString("utf8")) : undefined;
    const location = skillLocation.get(`${unit.name}:${skill.name}`) ?? `recurso MCP modai://skills/${skill.name}`;
    sections.skills.push(`- \`${skill.name}\` (${unit.name}) — ${description ?? "ver SKILL.md"} → ${location}`);
  }
  for (const tool of contributes.tools)
    sections.tools.push(
      `- \`${tool.name}\` (${unit.name})${tool.implements ? ` implementa \`${tool.implements}\`` : ""} — ${tool.description}`,
    );
  for (const component of contributes.components) {
    const directory = expandTemplate(component.target, { component: component.name, package: unit.name });
    sections.components.push(
      `- \`${component.name}\` (${unit.name})${component.description ? ` — ${component.description}` : ""} → \`${directory}\``,
    );
  }
  if (contributes.knowledge.length) sections.knowledge.push(`${unit.name} (${contributes.knowledge.length})`);
  for (const capability of provides)
    sections.capabilities.push(`\`${capability.capability}@${capability.version}\` ← ${unit.name}`);
}

function renderSections(sections: IndexSections): string {
  const { skills, tools, components, knowledge, capabilities } = sections;
  const parts = [
    "## Capacidades MODAI",
    "Bloque generado por `modai sync` a partir de modai.yaml y modai.lock; no lo edites a mano.",
  ];
  if (skills.length) parts.push(`### Skills (cárgalas solo cuando la tarea lo requiera)\n\n${skills.join("\n")}`);
  if (tools.length)
    parts.push(
      `### Herramientas (servidor MCP \`modai\`; requieren \`modai permissions grant\` en este equipo)\n\n${tools.join("\n")}`,
    );
  if (components.length)
    parts.push(
      `### Componentes de código (instalados en el proyecto; adáptalos libremente, MODAI conserva tus cambios)\n\n${components.join("\n")}`,
    );
  if (knowledge.length)
    parts.push(
      `### Conocimiento\n\nUsa \`modai_search_knowledge\` para recuperar fragmentos relevantes en lugar de cargar documentos completos. Fuentes: ${knowledge.join(", ")}.`,
    );
  if (capabilities.length) parts.push(`### Capacidades disponibles\n\n${capabilities.join("\n")}`);
  return parts.join("\n\n");
}

export function renderCapabilityIndex(units: InstallUnit[], skillLocation: Map<string, string>): string | undefined {
  const sections: IndexSections = { skills: [], tools: [], knowledge: [], capabilities: [], components: [] };
  for (const unit of units) collectUnit(unit, skillLocation, sections);
  if (Object.values(sections).every((list) => !list.length)) return undefined;
  return renderSections(sections);
}
