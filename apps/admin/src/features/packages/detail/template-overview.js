import { html } from "../../../shared/lib/html.js";
import { formatDate } from "../../../shared/ui/format.js";
import { deprecationCallout } from "./overview-panel.js";

export function templateOverviewPanel(item, info) {
  return html`
    <p class="lead">${info.description}</p>
    ${deprecationCallout(item)}
    ${info.keywords?.length ? html`<ul class="chip-list">${info.keywords.map((tag) => html`<li class="chip">${tag}</li>`)}</ul>` : ""}
    <div id="templateUsage"><p class="muted small">Cargando opciones…</p></div>
    <dl class="definition-grid">
      <div><dt>Tipo (kind)</dt><dd>Template de proyecto</dd></div>
      <div><dt>Categoría</dt><dd>${info.category}</dd></div>
      <div><dt>Publicado</dt><dd>${formatDate(item.publishedAt)}</dd></div>
      ${info.license ? html`<div><dt>Licencia</dt><dd>${info.license}</dd></div>` : ""}
    </dl>`;
}
