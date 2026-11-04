import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { featureList, featurePicker } from "../../../shared/pickers/feature-picker.js";
import { codeBlock } from "../../../shared/ui/code-block.js";
import { formatDate } from "../../../shared/ui/format.js";

const permissionLabels = {
  "project.instructions": "Escribir instrucciones del agente",
  "project.files": "Instalar archivos en docs/",
  "project.source": "Instalar código fuente en el proyecto",
  "process.execute": "Ejecutar comandos",
  "mcp.connect": "Iniciar servidores MCP",
  "filesystem.read": "Leer archivos del proyecto",
  "filesystem.write": "Escribir archivos del proyecto",
  network: "Usar la red",
  "env.read": "Leer variables de entorno",
};
const INSTALL_PERMISSIONS = ["project.instructions", "project.files", "project.source"];

export function installCommand(item, info, flags = []) {
  const allow = info.permissions.filter((permission) => INSTALL_PERMISSIONS.includes(permission));
  return `modai add ${item.name}@${item.version}${flags.length ? ` ${flags.join(" ")}` : ""}${allow.length ? ` --allow ${allow.join(",")}` : ""}`;
}

function capabilityList(items, emptyText) {
  return items.length
    ? html`<ul class="chip-list">${items.map((item) => html`<li class="chip" title="${item.description || ""}"><code>${item.capability}</code><span class="muted">${item.version}</span></li>`)}</ul>`
    : html`<p class="muted small">${emptyText}</p>`;
}

function contributionsSummary(info) {
  const c = info.contributes;
  const rows = [
    ["Skills", c.skills.map((item) => item.name)],
    ["Reglas", c.rules.map((item) => item.name)],
    ["Conocimiento", c.knowledge.map((item) => item.title || item.path || item.source)],
    ["Herramientas", c.tools.map((item) => item.name)],
    ["Servidores MCP", c.mcpServers.map((item) => item.name)],
    ["Agentes", c.agents.map((item) => item.name)],
    ["Componentes", c.components.map((item) => `${item.name} → ${item.target}`)],
    ["Archivos", c.files.map((item) => item.target)],
  ].filter(([, list]) => list.length);
  return rows.length
    ? html`<dl class="definition-grid">${rows.map(([label, list]) => html`<div><dt>${label} <span class="count">${list.length}</span></dt><dd>${list.slice(0, 8).join(", ")}${list.length > 8 ? ` y ${list.length - 8} más` : ""}</dd></div>`)}</dl>`
    : html`<p class="muted small">Este paquete no declara contribuciones.</p>`;
}

export function deprecationCallout(item) {
  if (!item.deprecatedMessage) return "";
  const yanked = item.status === "yanked";
  return html`<div class="callout tone-${yanked ? "danger" : "warning"}">${icon("alert")}<span><b>${yanked ? "Versión retirada" : "Versión deprecada"}:</b> ${item.deprecatedMessage}</span></div>`;
}

function agentsCallout(agents) {
  if (!agents.length) return "";
  return html`<div class="callout tone-info">${icon("bot")}<span>Incluye ${agents.length === 1 ? "un agente" : `${agents.length} agentes`}: actívalo en tu editor o envíale una tarea a un worker.</span><span class="row-actions">${agents.map((agent, index) => html`<button type="button" class="btn small" data-action="useAgent" data-index="${index}">${icon("play", 16)}Usar ${agent.name || "agente"}</button>`)}</span></div>`;
}

function signature(item) {
  if (!item.signerFingerprint) return html`<span class="muted">Sin firma</span>`;
  return html`<code title="${item.signerFingerprint}">${item.signerFingerprint.slice(0, 16)}…</code> ${item.publisherTrusted ? html`<span class="badge tone-success">De confianza</span>` : html`<span class="badge">No verificado</span>`}`;
}

const optionalRow = (value, label, content) => (value ? html`<div><dt>${label}</dt><dd>${content}</dd></div>` : "");

function definitions(item, info) {
  return html`<dl class="definition-grid">
      <div><dt>Formato</dt><dd><code>${info.apiVersion}</code></dd></div>
      ${optionalRow(info.kind, "Tipo (kind)", info.kind)}
      <div><dt>Categoría</dt><dd>${info.category}</dd></div>
      <div><dt>Publicado</dt><dd>${formatDate(item.publishedAt)}</dd></div>
      <div><dt>Firma</dt><dd>${signature(item)}</dd></div>
      <div><dt>Calidad estructural</dt><dd>${item.quality ? `${item.quality.score}/100` : html`<span class="muted">Sin evaluar</span>`}</dd></div>
      ${optionalRow(info.license, "Licencia", info.license)}
      ${optionalRow(info.authors?.length, "Autoría", info.authors?.join(", "))}
    </dl>`;
}

function permissionsList(permissions) {
  if (!permissions.length) return html`<p class="muted small">No solicita permisos especiales.</p>`;
  return html`<ul class="chip-list">${permissions.map((permission) => html`<li class="chip warn" title="${permission}">${icon("shield", 14)}${permissionLabels[permission] || permission}</li>`)}</ul>`;
}

function dependencyList(deps) {
  if (!deps.length) return html`<p class="muted small">Sin dependencias.</p>`;
  return html`<ul class="chip-list">${deps.map(([name, range]) => html`<li class="chip"><code>${name}</code><span class="muted">${range}</span></li>`)}</ul>`;
}

export function overviewPanel(item, info) {
  const deps = Object.entries(info.dependencies || {});
  return html`
    <p class="lead">${info.description}</p>
    ${agentsCallout(info.contributes.agents)}
    ${deprecationCallout(item)}
    ${featurePicker("packageFeatures", featureList(item.manifest?.spec?.features), html`Marca lo que quieres y el comando se arma solo. En la CLI: <code>modai add ${item.name} --help</code>; después se cambian con <code>modai feature enable|disable</code>.`)}
    ${codeBlock("installCommand", installCommand(item, info), "Copiar")}
    ${info.contributes.components.length ? html`<p class="hint">Los componentes se copian al proyecto. Quien los instale puede modificarlos: <code>modai remove</code> conserva los archivos editados.</p>` : ""}
    ${definitions(item, info)}
    <h4>Provee</h4>${capabilityList(info.provides, "No declara capacidades provistas.")}
    <h4>Requiere</h4>${capabilityList(info.requires, "No requiere otras capacidades.")}
    ${info.optional.length ? html`<h4>Opcionales</h4>${capabilityList(info.optional, "")}` : ""}
    <h4>Permisos solicitados</h4>
    ${permissionsList(info.permissions)}
    <h4>Contribuciones</h4>${contributionsSummary(info)}
    <h4>Dependencias</h4>
    ${dependencyList(deps)}`;
}
