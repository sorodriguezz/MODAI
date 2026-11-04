import { can } from "../../app/state.js";
import { html } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { emptyState } from "../../shared/ui/empty-state.js";
import { timeTag } from "../../shared/ui/format.js";

function organizationCell(p) {
  if (!p.organizationId) return html`<span class="muted">Personal</span>`;
  return p.organizationName || html`<code>${p.organizationId}</code>`;
}

function rowActions(p) {
  const id = encodeURIComponent(p.id);
  return html`<td class="actions">
              <a class="btn small ghost" href="#/memories?projectId=${id}">${icon("brain", 16)}Memoria</a>
              <a class="btn small ghost" href="#/runs?projectId=${id}">${icon("play", 16)}Ejecuciones</a>
              ${can.manageKeys() ? html`<a class="btn small ghost" href="#/connect?projectId=${id}">${icon("link", 16)}Dar acceso</a>` : ""}
              ${p.canEdit ? html`<button type="button" class="icon-button small" data-action="edit" data-id="${p.id}" aria-label="Editar el proyecto ${p.name}" title="Editar proyecto">${icon("edit", 16)}</button>` : ""}
              ${p.canDelete ? html`<button type="button" class="icon-button small danger" data-action="delete" data-id="${p.id}" aria-label="Eliminar el proyecto ${p.name} (${p.id})" title="Eliminar proyecto">${icon("trash", 16)}</button>` : ""}
            </td>`;
}

const projectRow = (p) => html`<tr>
            <td><b>${p.name}</b></td>
            <td><span class="inline-copy"><code>${p.id}</code><button type="button" class="icon-button small" data-action="copy" data-value="${p.id}" aria-label="Copiar identificador ${p.id}">${icon("copy", 16)}</button></span></td>
            <td class="hide-sm">${organizationCell(p)}</td>
            <td class="hide-sm">${timeTag(p.createdAt)}</td>
            ${rowActions(p)}</tr>`;

function noProjects() {
  const creator = can.createProject();
  return emptyState({
    iconName: "folder",
    title: "No tienes proyectos",
    text: creator
      ? "Crea uno para guardar memoria y enviar tareas."
      : "Pide a la administración que te asigne un proyecto.",
    action: creator ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo proyecto</button>` : "",
  });
}

export function projectTable(list, total) {
  if (list.length)
    return html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Proyecto</th><th scope="col">Identificador</th><th scope="col" class="hide-sm">Organización</th><th scope="col" class="hide-sm">Creado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map(projectRow)}</tbody></table></div>`;
  return total ? emptyState({ iconName: "search", title: "Sin coincidencias" }) : noProjects();
}

export function matchesProject(p, q, org) {
  if (org && (org === "none" ? p.organizationId : p.organizationId !== org)) return false;
  return !q || [p.name, p.id, p.organizationName].join(" ").toLocaleLowerCase().includes(q);
}

export function organizationOptions(projects, selected) {
  const organizations = [
    ...new Map(
      projects.filter((p) => p.organizationId).map((p) => [p.organizationId, p.organizationName || p.organizationId]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const personal = projects.some((p) => !p.organizationId)
    ? html`<option value="none" ${selected === "none" ? "selected" : ""}>Sin organización</option>`
    : "";
  return html`<option value="">Todas las organizaciones</option>${organizations.map(([id, name]) => html`<option value="${id}" ${id === selected ? "selected" : ""}>${name}</option>`)}${personal}`;
}
