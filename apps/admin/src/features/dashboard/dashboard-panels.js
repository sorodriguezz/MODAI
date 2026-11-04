import { can, state } from "../../app/state.js";
import { html } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { emptyState } from "../../shared/ui/empty-state.js";
import { timeTag } from "../../shared/ui/format.js";
import { skeletonRows } from "../../shared/ui/skeleton.js";
import { actionLabel } from "./action-labels.js";

export function accessText() {
  if (can.admin()) return "Tienes acceso completo al servidor.";
  if (can.manage())
    return `Administras: ${can
      .managedOrganizations()
      .map((o) => o.name)
      .join(", ")}.`;
  return "Algunas acciones dependen de los permisos que te asigne la administración.";
}

export function sidePanel() {
  return can.admin()
    ? html`<div class="panel"><div class="panel-head"><h3>Actividad reciente</h3><a class="link" href="#/audit">Ver auditoría</a></div><div id="recentAudit">${skeletonRows(4, 3)}</div></div>`
    : html`<div class="panel"><div class="panel-head"><h3>Tu acceso</h3></div><div class="panel-body" id="accessSummary"></div></div>`;
}

export function serverInfo(h) {
  if (!h) return html`<div><dt>Estado</dt><dd><span class="badge tone-warning">Sin datos de /health</span></dd></div>`;
  return html`<div><dt>Estado</dt><dd><span class="badge tone-success"><span class="dot"></span>En línea</span></dd></div>
          <div><dt>Versión</dt><dd>${h.version} · API v${h.apiVersion}</dd></div>
          <div><dt>Runtime</dt><dd>${h.runtime}</dd></div>
          <div><dt>Política de firmas</dt><dd>${h.signaturePolicy}</dd></div>
          <div><dt>URL pública</dt><dd>${h.publicUrl || html`<span class="muted">No configurada (${location.origin})</span>`}</dd></div>
          <div><dt>Inferencia</dt><dd>En los clientes o workers; el servidor no ejecuta modelos</dd></div>`;
}

const joinedOr = (list, empty) => (list?.length ? list.join(", ") : empty);

export function accessSummary() {
  const identity = state.identity;
  const permissions = state.permissions;
  const organizations = permissions?.organizations.map((o) => o.name + (o.manage ? " (administras)" : ""));
  return html`<dl class="definition-grid single">
        <div><dt>Proyectos asignados</dt><dd>${joinedOr(identity.projectIds, "Ninguno (más los que crees)")}</dd></div>
        <div><dt>Organizaciones</dt><dd>${joinedOr(organizations, "Ninguna")}</dd></div>
        <div><dt>Namespaces publicables</dt><dd>${joinedOr(permissions?.publish.namespaces, "Ninguno")}</dd></div>
      </dl>`;
}

export function recentPackages(recent) {
  if (!recent.length)
    return emptyState({
      iconName: "package",
      title: "Aún no hay paquetes",
      text: "Publica el primero con modai package publish desde la CLI.",
    });
  return html`<ul class="list">${recent.map((item) => html`<li><a href="#/packages?name=${encodeURIComponent(item.name)}"><span class="list-icon">${icon("package")}</span><span class="list-main"><b>${item.name}</b><span class="muted">v${item.version} · ${item.category}</span></span>${timeTag(item.publishedAt)}</a></li>`)}</ul>`;
}

function eventIcon(action) {
  if (action.startsWith("auth")) return "lock";
  return action.startsWith("user") ? "users" : "activity";
}

const eventItem = (event) =>
  html`<li><div class="list-row"><span class="list-icon ${event.action.endsWith("failed") ? "danger" : ""}">${icon(eventIcon(event.action))}</span><span class="list-main"><b>${actionLabel(event.action)}</b><span class="muted">${event.actor} · ${event.resource}</span></span>${timeTag(event.createdAt)}</div></li>`;

export function recentAudit(events) {
  return events.length
    ? html`<ul class="list">${events.map(eventItem)}</ul>`
    : emptyState({ iconName: "activity", title: "Sin actividad todavía" });
}
