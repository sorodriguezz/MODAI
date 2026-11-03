import { del, get, patch, post } from "../lib/api.js";
import { delegate, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import {
  bindForm,
  closeDialog,
  confirmDialog,
  debounce,
  emptyState,
  errorState,
  openDialog,
  skeletonRows,
  timeTag,
  toast,
} from "../lib/ui.js";
import { can, store } from "../state.js";
import { pruneDialog } from "./audit.js";

const kinds = {
  decision: "Decisión",
  convention: "Convención",
  learning: "Aprendizaje",
  note: "Nota",
  todo: "Pendiente",
};
const scopes = { project: "Proyecto", organization: "Organización", session: "Sesión" };
let lastProject = "";

function memoryForm(project, memory, onSaved) {
  const body = openDialog({
    title: memory ? "Editar memoria" : "Añadir memoria",
    description: "Proyecto " + project.name,
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field-row">
        <div class="field"><label for="memoryKind">Tipo</label><input id="memoryKind" list="memoryKinds" maxlength="100" value="${memory?.kind || "decision"}"><datalist id="memoryKinds">${Object.keys(kinds).map((kind) => html`<option value="${kind}">${kinds[kind]}</option>`)}</datalist></div>
        ${memory ? "" : html`<div class="field"><label for="memoryScope">Alcance</label><select id="memoryScope"><option value="project">Proyecto</option>${project.organizationId ? html`<option value="organization">Organización (${project.organizationId})</option>` : ""}</select></div>`}
      </div>
      <div class="field"><label for="memoryContent">¿Qué debe recordar el agente?</label><textarea id="memoryContent" rows="7" required maxlength="100000" placeholder="Una decisión, una convención o un aprendizaje…">${memory?.content || ""}</textarea></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Guardar</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const kind = form.memoryKind.value.trim() || "note";
    if (memory) await patch("/memories/" + encodeURIComponent(memory.id), { content: form.memoryContent.value, kind });
    else
      await post("/memories", {
        projectId: project.id,
        content: form.memoryContent.value,
        kind,
        scope: form.memoryScope.value,
      });
    closeDialog();
    toast(memory ? "Memoria actualizada" : "Memoria guardada");
    await onSaved();
  });
}

export default {
  id: "memories",
  label: "Memorias",
  icon: "brain",
  title: "Memorias",
  subtitle: "Decisiones y contexto de cada proyecto que sobreviven entre sesiones.",
  async render(root, { actions, params, isCurrent }) {
    mount(
      root,
      html`
      <div class="toolbar">
        <label class="sr-only" for="memoryProject">Proyecto</label><select id="memoryProject" class="grow"><option value="">Cargando proyectos…</option></select>
        <div class="search-field">${icon("search")}<label class="sr-only" for="memorySearch">Buscar en la memoria</label><input id="memorySearch" type="search" placeholder="Búsqueda de texto completo…"></div>
        <label class="sr-only" for="memoryKindFilter">Tipo</label><select id="memoryKindFilter"><option value="">Todos los tipos</option></select>
        <label class="checkbox"><input type="checkbox" id="memoryOrg"> Incluir organización</label>
      </div>
      <p class="results-meta" id="memoryMeta" aria-live="polite"></p>
      <div id="memoryResults">${skeletonRows(4, 2)}</div>`,
    );
    const $project = root.querySelector("#memoryProject"),
      $search = root.querySelector("#memorySearch"),
      $kind = root.querySelector("#memoryKindFilter"),
      $org = root.querySelector("#memoryOrg");
    let projects = [],
      memories = [];
    const project = () => projects.find((p) => p.id === $project.value);
    const updateActions = () => {
      mount(
        actions,
        html`${can.admin() ? html`<button class="btn" data-action="prune">${icon("trash")}Depurar antiguas</button>` : ""}${project() && can.writeMemory() ? html`<button class="btn primary" data-action="new">${icon("plus")}Añadir memoria</button>` : ""}`,
      );
      // Organization memory only exists for projects linked to an organization.
      $org.disabled = !project()?.organizationId;
      if ($org.disabled) $org.checked = false;
      $org.closest("label").title = $org.disabled ? "El proyecto no pertenece a una organización" : "";
    };

    const draw = () => {
      const kind = $kind.value;
      const list = memories.filter((m) => !kind || m.kind === kind);
      const query = $search.value.trim();
      root.querySelector("#memoryMeta").textContent = project()
        ? query
          ? list.length + " resultados para «" + query + "»"
          : list.length + (memories.length >= 200 ? " memorias más recientes" : " memorias")
        : "";
      mount(
        root.querySelector("#memoryResults"),
        !project()
          ? emptyState({
              iconName: "folder",
              title: projects.length ? "Elige un proyecto" : "No tienes proyectos",
              text: projects.length ? "La memoria se organiza por proyecto." : "Crea un proyecto o pide acceso a uno.",
            })
          : list.length
            ? html`<ul class="memory-list">${list.map(
                (m) => html`<li class="memory-item">
              <div class="memory-head"><span class="badge tone-info">${kinds[m.kind] || m.kind}</span><span class="badge">${scopes[m.scope] || m.scope}</span>${timeTag(m.updatedAt || m.createdAt)}
                ${can.writeMemory() ? html`<span class="memory-actions"><button type="button" class="icon-button small" data-action="edit" data-id="${m.id}" aria-label="Editar memoria">${icon("edit", 16)}</button><button type="button" class="icon-button small danger-text" data-action="delete" data-id="${m.id}" aria-label="Eliminar memoria">${icon("trash", 16)}</button></span>` : ""}
              </div>
              <p class="memory-content">${m.content}</p></li>`,
              )}</ul>`
            : emptyState({
                iconName: "brain",
                title: query ? "Sin coincidencias" : "Este proyecto aún no tiene memoria",
                text: query
                  ? "Prueba con otros términos."
                  : "Añade una nota o deja que tu agente guarde decisiones mediante MCP.",
              }),
      );
    };

    const loadMemories = async () => {
      updateActions();
      const current = project();
      if (!current) return draw();
      lastProject = current.id;
      mount(root.querySelector("#memoryResults"), skeletonRows(4, 2));
      const query = $search.value.trim();
      try {
        memories = query
          ? (
              await post("/memories/search", {
                projectId: current.id,
                query,
                limit: 50,
                includeOrganization: $org.checked,
              })
            ).results
          : (
              await get(
                "/memories?projectId=" +
                  encodeURIComponent(current.id) +
                  "&limit=200" +
                  ($org.checked ? "&includeOrganization=true" : ""),
              )
            ).memories;
      } catch (error) {
        memories = [];
        if (isCurrent()) mount(root.querySelector("#memoryResults"), errorState(error));
        return;
      }
      if (!isCurrent()) return;
      const knownKinds = [...new Set(memories.map((m) => m.kind))].sort();
      const selected = $kind.value;
      mount(
        $kind,
        html`<option value="">Todos los tipos</option>${knownKinds.map((kind) => html`<option value="${kind}">${kinds[kind] || kind}</option>`)}`,
      );
      $kind.value = knownKinds.includes(selected) ? selected : "";
      draw();
    };

    try {
      projects = await store.projects();
    } catch (error) {
      mount(root.querySelector("#memoryResults"), errorState(error));
      return;
    }
    if (!isCurrent()) return;
    mount(
      $project,
      html`<option value="">Selecciona un proyecto</option>${projects.map((p) => html`<option value="${p.id}">${p.name} (${p.id})</option>`)}`,
    );
    const wanted = params.get("projectId") || lastProject || (projects.length === 1 ? projects[0].id : "");
    $project.value = projects.some((p) => p.id === wanted) ? wanted : "";

    $project.addEventListener("change", () => {
      $search.value = "";
      loadMemories();
    });
    $search.addEventListener("input", debounce(loadMemories, 350));
    $kind.addEventListener("change", draw);
    $org.addEventListener("change", loadMemories);
    const handlers = {
      prune: () => pruneDialog("memories", loadMemories),
      new: () => project() && memoryForm(project(), null, loadMemories),
      edit: (button) => {
        const memory = memories.find((m) => m.id === button.dataset.id);
        if (memory) memoryForm(project(), memory, loadMemories);
      },
      delete: (button) =>
        confirmDialog({
          title: "Eliminar memoria",
          message: "Esta nota dejará de estar disponible para los agentes del proyecto.",
          confirmLabel: "Eliminar",
          action: () => del("/memories/" + encodeURIComponent(button.dataset.id)),
        }).then(async (ok) => {
          if (!ok) return;
          toast("Memoria eliminada");
          await loadMemories();
        }),
      retry: loadMemories,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await loadMemories();
  },
};
