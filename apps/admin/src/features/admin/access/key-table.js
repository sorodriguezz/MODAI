import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { emptyState } from "../../../shared/ui/empty-state.js";
import { timeTag } from "../../../shared/ui/format.js";
import { roleBadge } from "../../../shared/ui/labels.js";
import { keyAccess } from "../../keys/key-wizard.js";

function ownerCell(k) {
  return k.ownerId
    ? html`<a href="#/access?owner=${encodeURIComponent(k.ownerId)}">@${k.ownerName}</a>`
    : html`<span class="muted">—</span>`;
}

function statusCell(k) {
  return k.revokedAt
    ? html`<span class="badge tone-danger"><span class="dot"></span>Revocada</span>`
    : html`<span class="badge tone-success"><span class="dot"></span>Activa</span>`;
}

function actionsCell(k) {
  if (k.revokedAt) return "";
  return html`<button type="button" class="btn small ghost" data-action="editKey" data-id="${k.id}">${icon("edit", 16)}<span class="hide-sm">${k.ownerId ? "Accesos" : "Asignar dueño"}</span></button><button type="button" class="btn small ghost danger-text" data-action="revoke" data-id="${k.id}">Revocar</button>`;
}

function keyRow(k) {
  return html`<tr class="${k.revokedAt ? "is-disabled" : ""}">
            <td><b>${k.label}</b><div class="muted small">Creada ${timeTag(k.createdAt)}</div></td>
            <td>${ownerCell(k)}</td>
            <td>${roleBadge(k.role)}</td>
            <td class="hide-sm">${keyAccess(k)}</td>
            <td class="hide-sm">${timeTag(k.lastUsedAt, "Sin uso")}</td>
            <td>${statusCell(k)}</td>
            <td class="actions">${actionsCell(k)}</td>
          </tr>`;
}

function emptyKeys(q, total) {
  if (q) return emptyState({ iconName: "search", title: "Sin coincidencias", text: "Prueba con otro nombre." });
  return emptyState({
    iconName: "key",
    title: total ? "No hay API keys activas" : "Aún no hay API keys",
    text: total
      ? "Las revocadas siguen visibles con «Mostrar revocadas»."
      : "Crea una credencial para cada cliente que use la CLI, MCP o un worker.",
    action: html`<button class="btn primary" data-action="newKey">${icon("plus")}Nueva API key</button>`,
  });
}

export function keysTable(list, { q, total }) {
  if (!list.length) return emptyKeys(q, total);
  return html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Nombre</th><th scope="col">Dueño</th><th scope="col">Rol</th><th scope="col" class="hide-sm">Accesos</th><th scope="col" class="hide-sm">Último uso</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map(keyRow)}</tbody></table></div>`;
}

export function keyMatches(k, { q, showRevoked, ownerFilter }) {
  if (!showRevoked && k.revokedAt) return false;
  if (ownerFilter && k.ownerId !== ownerFilter) return false;
  return !q || [k.label, k.ownerName].join(" ").toLocaleLowerCase().includes(q);
}
