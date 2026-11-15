import { state } from "../../../app/state.js";
import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { timeTag } from "../../../shared/ui/format.js";
import { initials, roleBadge } from "../../../shared/ui/labels.js";
import { actionsColumn, dataTable, optionalColumn } from "../../../shared/ui/table.js";

const LAST_ADMIN = "Debe quedar al menos un administrador activo";

function organizationsCell(u, orgNames) {
  if (u.role === "admin") return html`<span class="muted">Todas</span>`;
  return u.organizationIds.length ? orgNames(u.organizationIds) : html`<span class="muted">Ninguna</span>`;
}

function projectsCell(u) {
  if (u.role === "admin") return html`<span class="muted">Todos</span>`;
  return u.projectIds.length ? u.projectIds.length : html`<span class="muted">Ninguno</span>`;
}

function statusCell(u) {
  return u.disabledAt
    ? html`<span class="badge tone-danger"><span class="dot"></span>Desactivado</span>`
    : html`<span class="badge tone-success"><span class="dot"></span>Activo</span>`;
}

function dangerActions(u, lastAdmin) {
  return html`<button type="button" class="btn small ghost" data-action="toggle" data-id="${u.id}" ${lastAdmin ? "disabled" : ""} title="${lastAdmin ? LAST_ADMIN : ""}">${u.disabledAt ? "Activar" : "Desactivar"}</button>
                  <button type="button" class="icon-button small danger-text" data-action="delete" data-id="${u.id}" ${lastAdmin ? "disabled" : ""} aria-label="Eliminar ${u.username}" title="${lastAdmin ? LAST_ADMIN : "Eliminar"}">${icon("trash", 16)}</button>`;
}

function userRow(u, { orgNames, activeAdmins }) {
  const self = u.id === state.user?.id;
  const lastAdmin = u.role === "admin" && !u.disabledAt && activeAdmins <= 1;
  return html`<tr class="${u.disabledAt ? "is-disabled" : ""}">
              <td><div class="user-cell"><span class="avatar" aria-hidden="true">${initials(u.displayName || u.username)}</span><div><b>${u.displayName}</b>${self ? html` <span class="badge tone-info">Tú</span>` : ""}<div class="muted small">@${u.username}</div></div></div></td>
              <td>${roleBadge(u.role)}</td>
              <td class="hide-sm">${organizationsCell(u, orgNames)}</td>
              <td class="hide-sm">${projectsCell(u)}</td>
              <td class="hide-sm">${timeTag(u.lastLoginAt, "Nunca")}</td>
              <td>${statusCell(u)}</td>
              <td class="actions">
                <button type="button" class="btn small ghost" data-action="edit" data-id="${u.id}" aria-label="Editar ${u.username}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>
                <a class="btn small ghost" href="#/access?owner=${encodeURIComponent(u.id)}" aria-label="API keys de ${u.username}">${icon("key", 16)}<span class="hide-sm">API keys</span></a>
                <button type="button" class="btn small ghost" data-action="reset" data-id="${u.id}" aria-label="Restablecer contraseña de ${u.username}">${icon("lock", 16)}<span class="hide-sm">Contraseña</span></button>
                ${self ? "" : dangerActions(u, lastAdmin)}
              </td></tr>`;
}

export function usersTable(list, context) {
  return dataTable(
    [
      "Usuario",
      "Rol",
      optionalColumn("Organizaciones"),
      optionalColumn("Proyectos"),
      optionalColumn("Último acceso"),
      "Estado",
      actionsColumn(),
    ],
    list.map((u) => userRow(u, context)),
  );
}

export function matchesFilters(u, { q, roleFilter, status }) {
  if (roleFilter && u.role !== roleFilter) return false;
  if (status && (status === "active") === Boolean(u.disabledAt)) return false;
  return !q || `${u.username} ${u.displayName}`.toLocaleLowerCase().includes(q);
}
