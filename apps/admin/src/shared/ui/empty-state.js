import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";

export function emptyState({ iconName = "package", title, text, action }) {
  return html`<div class="empty-state"><span class="empty-icon">${icon(iconName, 26)}</span><h3>${title}</h3>${text ? html`<p>${text}</p>` : ""}${action || ""}</div>`;
}

export function errorState(error, retryAction = "retry") {
  return html`<div class="empty-state error"><span class="empty-icon">${icon("alert", 26)}</span><h3>No se pudo cargar</h3><p>${error.message}</p><button class="btn" data-action="${retryAction}">${icon("refresh")}Reintentar</button></div>`;
}
