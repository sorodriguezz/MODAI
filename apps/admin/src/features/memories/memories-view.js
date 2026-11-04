import { can, store } from "../../app/state.js";
import { del } from "../../shared/lib/api.js";
import { delegate, html, mount } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { confirmDialog } from "../../shared/ui/dialog.js";
import { errorState } from "../../shared/ui/empty-state.js";
import { debounce } from "../../shared/ui/format.js";
import { skeletonRows } from "../../shared/ui/skeleton.js";
import { toast } from "../../shared/ui/toast.js";
import { pruneDialog } from "../admin/audit/prune-dialog.js";
import { memoryForm } from "./memory-form.js";
import { fetchMemories, kindOptions, memoryMeta, memoryResults } from "./memory-list.js";

let lastProject = "";

const layout = () => html`
      <div class="toolbar">
        <label class="sr-only" for="memoryProject">Proyecto</label><select id="memoryProject" class="grow"><option value="">Cargando proyectos…</option></select>
        <div class="search-field">${icon("search")}<label class="sr-only" for="memorySearch">Buscar en la memoria</label><input id="memorySearch" type="search" placeholder="Búsqueda de texto completo…"></div>
        <label class="sr-only" for="memoryKindFilter">Tipo</label><select id="memoryKindFilter"><option value="">Todos los tipos</option></select>
        <label class="checkbox"><input type="checkbox" id="memoryOrg"> Incluir organización</label>
      </div>
      <p class="results-meta" id="memoryMeta" aria-live="polite"></p>
      <div id="memoryResults">${skeletonRows(4, 2)}</div>`;

function updateActions(ctx) {
  const project = ctx.project();
  mount(
    ctx.actions,
    html`${can.admin() ? html`<button class="btn" data-action="prune">${icon("trash")}Depurar antiguas</button>` : ""}${project && can.writeMemory() ? html`<button class="btn primary" data-action="new">${icon("plus")}Añadir memoria</button>` : ""}`,
  );
  const { $org } = ctx;
  $org.disabled = !project?.organizationId;
  if ($org.disabled) $org.checked = false;
  $org.closest("label").title = $org.disabled ? "El proyecto no pertenece a una organización" : "";
}

function draw(ctx) {
  const kind = ctx.$kind.value;
  const list = ctx.memories.filter((m) => !kind || m.kind === kind);
  const view = {
    project: ctx.project(),
    list,
    memories: ctx.memories,
    projects: ctx.projects,
    query: ctx.$search.value.trim(),
  };
  ctx.root.querySelector("#memoryMeta").textContent = memoryMeta(view);
  mount(ctx.root.querySelector("#memoryResults"), memoryResults(view));
}

async function loadMemories(ctx) {
  updateActions(ctx);
  const current = ctx.project();
  if (!current) return draw(ctx);
  lastProject = current.id;
  mount(ctx.root.querySelector("#memoryResults"), skeletonRows(4, 2));
  try {
    ctx.memories = await fetchMemories(current, ctx.$search.value.trim(), ctx.$org.checked);
  } catch (error) {
    ctx.memories = [];
    if (ctx.isCurrent()) mount(ctx.root.querySelector("#memoryResults"), errorState(error));
    return;
  }
  if (!ctx.isCurrent()) return;
  const { known, markup } = kindOptions(ctx.memories);
  const selected = ctx.$kind.value;
  mount(ctx.$kind, markup);
  ctx.$kind.value = known.includes(selected) ? selected : "";
  draw(ctx);
}

function memoryHandlers(ctx, reload) {
  return {
    prune: () => pruneDialog("memories", reload),
    new: () => ctx.project() && memoryForm(ctx.project(), null, reload),
    edit: (button) => {
      const memory = ctx.memories.find((m) => m.id === button.dataset.id);
      if (memory) memoryForm(ctx.project(), memory, reload);
    },
    delete: (button) =>
      confirmDialog({
        title: "Eliminar memoria",
        message: "Esta nota dejará de estar disponible para los agentes del proyecto.",
        confirmLabel: "Eliminar",
        action: () => del(`/memories/${encodeURIComponent(button.dataset.id)}`),
      }).then(async (ok) => {
        if (!ok) return;
        toast("Memoria eliminada");
        await reload();
      }),
    retry: reload,
  };
}

function selectProject(ctx, params) {
  const { projects, $project } = ctx;
  mount(
    $project,
    html`<option value="">Selecciona un proyecto</option>${projects.map((p) => html`<option value="${p.id}">${p.name} (${p.id})</option>`)}`,
  );
  const wanted = params.get("projectId") || lastProject || (projects.length === 1 ? projects[0].id : "");
  $project.value = projects.some((p) => p.id === wanted) ? wanted : "";
}

export const memoriesView = {
  id: "memories",
  label: "Memorias",
  icon: "brain",
  title: "Memorias",
  subtitle: "Decisiones y contexto de cada proyecto que sobreviven entre sesiones.",
  async render(root, { actions, params, isCurrent }) {
    mount(root, layout());
    const ctx = {
      root,
      actions,
      isCurrent,
      projects: [],
      memories: [],
      $project: root.querySelector("#memoryProject"),
      $search: root.querySelector("#memorySearch"),
      $kind: root.querySelector("#memoryKindFilter"),
      $org: root.querySelector("#memoryOrg"),
    };
    ctx.project = () => ctx.projects.find((p) => p.id === ctx.$project.value);
    const reload = () => loadMemories(ctx);
    try {
      ctx.projects = await store.projects();
    } catch (error) {
      mount(root.querySelector("#memoryResults"), errorState(error));
      return;
    }
    if (!isCurrent()) return;
    selectProject(ctx, params);
    ctx.$project.addEventListener("change", () => {
      ctx.$search.value = "";
      reload();
    });
    ctx.$search.addEventListener("input", debounce(reload, 350));
    ctx.$kind.addEventListener("change", () => draw(ctx));
    ctx.$org.addEventListener("change", reload);
    const handlers = memoryHandlers(ctx, reload);
    delegate(root, handlers);
    delegate(actions, handlers);
    await reload();
  },
};
