import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";

export const TYPES = {
  components: { label: "Componentes", icon: "code", create: "component" },
  harness: { label: "Harness", icon: "layers", create: "harness" },
  skills: { label: "Skills", icon: "spark", create: "skill" },
  tools: { label: "Herramientas y MCP", icon: "plug" },
  agents: { label: "Agentes", icon: "bot" },
  knowledge: { label: "Conocimiento", icon: "book", create: "knowledge" },
  profiles: { label: "Perfiles", icon: "user", create: "profile" },
  adapters: { label: "Adaptadores", icon: "plug" },
  templates: { label: "Templates", icon: "copy", create: "template" },
};

export function typeTabs() {
  return html`<div class="type-tabs" role="toolbar" aria-label="Tipo de paquete" id="packageTypes">
        <button type="button" data-action="type" data-type="" aria-pressed="false">Todos</button>
        ${Object.entries(TYPES).map(([id, type]) => html`<button type="button" data-action="type" data-type="${id}" aria-pressed="false">${icon(type.icon, 16)}${type.label}</button>`)}
      </div>`;
}

export function drawTypes(root, selected) {
  for (const button of root.querySelectorAll("#packageTypes [data-type]"))
    button.setAttribute("aria-pressed", String(button.dataset.type === selected));
}
