import { can } from "../../app/state.js";
import { get, post } from "../../shared/lib/api.js";
import { html } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { emptyState } from "../../shared/ui/empty-state.js";
import { timeTag } from "../../shared/ui/format.js";
import { kinds } from "./memory-form.js";

const scopes = { project: "Proyecto", organization: "Organización", session: "Sesión" };

const memoryActions = (m) =>
  can.writeMemory()
    ? html`<span class="memory-actions"><button type="button" class="icon-button small" data-action="edit" data-id="${m.id}" aria-label="Editar memoria">${icon("edit", 16)}</button><button type="button" class="icon-button small danger-text" data-action="delete" data-id="${m.id}" aria-label="Eliminar memoria">${icon("trash", 16)}</button></span>`
    : "";

const memoryItem = (m) => html`<li class="memory-item">
              <div class="memory-head"><span class="badge tone-info">${kinds[m.kind] || m.kind}</span><span class="badge">${scopes[m.scope] || m.scope}</span>${timeTag(m.updatedAt || m.createdAt)}
                ${memoryActions(m)}
              </div>
              <p class="memory-content">${m.content}</p></li>`;

export function memoryMeta({ project, list, memories, query }) {
  if (!project) return "";
  if (query) return `${list.length} resultados para «${query}»`;
  return list.length + (memories.length >= 200 ? " memorias más recientes" : " memorias");
}

export function memoryResults({ project, list, projects, query }) {
  if (!project)
    return emptyState({
      iconName: "folder",
      title: projects.length ? "Elige un proyecto" : "No tienes proyectos",
      text: projects.length ? "La memoria se organiza por proyecto." : "Crea un proyecto o pide acceso a uno.",
    });
  if (list.length) return html`<ul class="memory-list">${list.map(memoryItem)}</ul>`;
  return emptyState({
    iconName: "brain",
    title: query ? "Sin coincidencias" : "Este proyecto aún no tiene memoria",
    text: query ? "Prueba con otros términos." : "Añade una nota o deja que tu agente guarde decisiones mediante MCP.",
  });
}

export async function fetchMemories(project, query, includeOrganization) {
  if (query)
    return (await post("/memories/search", { projectId: project.id, query, limit: 50, includeOrganization })).results;
  const organization = includeOrganization ? "&includeOrganization=true" : "";
  return (await get(`/memories?projectId=${encodeURIComponent(project.id)}&limit=200${organization}`)).memories;
}

export function kindOptions(memories) {
  const known = [...new Set(memories.map((m) => m.kind))].sort();
  return {
    known,
    markup: html`<option value="">Todos los tipos</option>${known.map((kind) => html`<option value="${kind}">${kinds[kind] || kind}</option>`)}`,
  };
}
