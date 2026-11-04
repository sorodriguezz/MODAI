import { can } from "../../app/state.js";
import { html } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { emptyState } from "../../shared/ui/empty-state.js";
import { timeTag } from "../../shared/ui/format.js";

function originCell(d) {
  if (!d.packageName) return html`<span class="badge tone-info">Todo el servidor</span>`;
  return html`<span class="badge">${d.packageName}</span>${d.packageVersion ? "" : html` <span class="muted small">manual</span>`}`;
}

const documentRow = (d) => html`<tr>
              <td><button type="button" class="link-button" data-action="view" data-id="${d.id}">${d.title}</button>${(d.tags || []).length ? html`<div class="muted small">${d.tags.join(" · ")}</div>` : ""}</td>
              <td class="hide-sm">${originCell(d)}</td>
              <td>${timeTag(d.updatedAt || d.createdAt)}</td></tr>`;

export function matchesDocument(d, q, origin) {
  if (origin && (origin === "manual") === Boolean(d.packageName)) return false;
  return !q || `${d.title} ${d.content} ${(d.tags || []).join(" ")}`.toLocaleLowerCase().includes(q);
}

export function documentMeta(list, documents) {
  const capped = documents.length >= 500 ? " (se muestran los 500 más recientes)" : "";
  return `${list.length} de ${documents.length} documentos${capped}`;
}

export function documentTable(list, total) {
  if (list.length)
    return html`<div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Documento</th><th scope="col" class="hide-sm">Origen</th><th scope="col">Actualizado</th></tr></thead>
            <tbody>${list.map(documentRow)}</tbody></table></div>`;
  if (total) return emptyState({ iconName: "search", title: "Sin coincidencias", text: "Prueba con otras palabras." });
  return emptyState({
    iconName: "book",
    title: "Aún no hay conocimiento",
    text: "Los paquetes con conocimiento lo añaden al publicarse. También puedes crear documentos manuales.",
    action: can.createKnowledge()
      ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo documento</button>`
      : "",
  });
}
