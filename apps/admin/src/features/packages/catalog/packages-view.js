import { can, store } from "../../../app/state.js";
import { get } from "../../../shared/lib/api.js";
import { delegate, html, mount } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { emptyState, errorState } from "../../../shared/ui/empty-state.js";
import { debounce } from "../../../shared/ui/format.js";
import { skeletonCards } from "../../../shared/ui/skeleton.js";
import { openPackage } from "../detail/open-package.js";
import { openPackageEditor } from "../editor/package-editor.js";
import { openTemplateEditor } from "../templates/template-editor.js";
import { packageCard } from "./package-card.js";
import { pager } from "./pager.js";
import { drawTypes, TYPES, typeTabs } from "./type-tabs.js";

const filters = { q: "", type: "", category: "", status: "latest" };
const PAGE_SIZE = 24;

const createButton = () => html`<button class="btn primary" data-action="create">${icon("plus")}Crear paquete</button>`;

function catalogMarkup() {
  return html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="packageSearch">Buscar paquetes</label><input id="packageSearch" type="search" placeholder="Buscar por nombre, descripción o capacidad…" value="${filters.q}"></div>
        <label class="sr-only" for="packageCategory">Categoría</label><select id="packageCategory"><option value="">Todas las categorías</option></select>
        <label class="sr-only" for="packageStatus">Estado</label><select id="packageStatus"><option value="latest">Última versión activa</option><option value="all">Todas las versiones</option><option value="deprecated">Deprecadas</option><option value="yanked">Retiradas</option></select>
      </div>
      ${typeTabs()}
      <p class="results-meta" id="packageMeta" aria-live="polite"></p>
      <div id="packageResults">${skeletonCards()}</div>`;
}

function emptyResults(filtered) {
  if (filtered)
    return emptyState({
      iconName: "search",
      title: "Sin resultados",
      text: "Prueba con otra búsqueda o cambia los filtros.",
      action: html`<button class="btn" data-action="clear">Limpiar filtros</button>`,
    });
  return emptyState({
    iconName: "package",
    title: "Aún no hay paquetes",
    text: "Publica con la CLI (modai package publish ./mi-paquete, modai template publish ./proyecto) o créalos aquí: componentes, harnesses, skills, conocimiento, perfiles y templates de proyecto.",
    action: can.publish() ? createButton() : "",
  });
}

function catalogQuery(page) {
  const query = new URLSearchParams({
    status: filters.status,
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  for (const key of ["q", "type", "category"]) if (filters[key]) query.set(key, filters[key]);
  return query;
}

function drawResults(view, result, pages) {
  const { $category } = view;
  const selected = filters.category;
  mount(
    $category,
    html`<option value="">Todas las categorías</option>${result.categories.map((category) => html`<option value="${category}">${category}</option>`)}`,
  );
  $category.value = result.categories.includes(selected) ? selected : "";
  const filtered = Boolean(filters.q || filters.type || filters.category || filters.status !== "latest");
  const total = result.total;
  view.root.querySelector("#packageMeta").textContent =
    `${total}${total === 1 ? " paquete" : " paquetes"}${filters.status === "latest" ? " · última versión activa de cada uno" : ""}`;
  mount(
    view.root.querySelector("#packageResults"),
    result.items.length
      ? html`<div class="card-grid">${result.items.map(packageCard)}</div>${pager(view.page, pages)}`
      : emptyResults(filtered),
  );
}

function readFilters(view) {
  filters.q = view.$q.value.trim();
  filters.category = view.wantedCategory ?? view.$category.value;
  view.wantedCategory = null;
  filters.status = view.$status.value;
}

async function loadCatalog(view) {
  readFilters(view);
  const token = ++view.request;
  let result;
  try {
    result = await get(`/packages/catalog?${catalogQuery(view.page)}`);
  } catch (error) {
    if (view.isCurrent() && token === view.request)
      mount(view.root.querySelector("#packageResults"), errorState(error));
    return;
  }
  if (!view.isCurrent() || token !== view.request) return;
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  if (view.page > pages) {
    view.page = pages;
    return loadCatalog(view);
  }
  drawResults(view, result, pages);
}

function applyParams(params) {
  if (params.has("type")) filters.type = TYPES[params.get("type")] ? params.get("type") : "";
  if (params.has("q")) filters.q = params.get("q");
}

function catalogActions(view, create, published) {
  const { root } = view;
  return {
    create,
    open: (button) => openPackage(button.dataset.name, button.dataset.version, view.load, published),
    type: (button) => {
      filters.type = button.dataset.type;
      drawTypes(root, filters.type);
      view.reload();
    },
    page: (button) => {
      view.page = Number(button.dataset.page);
      view.load().then(() => root.querySelector("#packageResults")?.scrollIntoView({ block: "start" }));
    },
    clear: () => {
      view.$q.value = "";
      filters.type = "";
      drawTypes(root, filters.type);
      view.$category.value = "";
      view.$status.value = "latest";
      view.reload();
    },
    retry: view.load,
  };
}

export const packagesView = {
  id: "packages",
  label: "Paquetes",
  icon: "package",
  title: "Paquetes",
  subtitle:
    "Todo lo que se publica y versiona bajo un namespace: componentes, harnesses, skills, herramientas, agentes, conocimiento, perfiles, adaptadores y templates de proyecto.",
  async render(root, { params, isCurrent, actions }) {
    if (can.publish()) mount(actions, createButton());
    mount(root, catalogMarkup());
    applyParams(params);
    drawTypes(root, filters.type);
    const view = {
      root,
      isCurrent,
      wantedCategory: params.get("category"),
      $q: root.querySelector("#packageSearch"),
      $category: root.querySelector("#packageCategory"),
      $status: root.querySelector("#packageStatus"),
      page: 1,
      request: 0,
    };
    view.$status.value = filters.status;
    view.load = () => loadCatalog(view);
    view.reload = () => {
      view.page = 1;
      return view.load();
    };
    view.$q.addEventListener("input", debounce(view.reload, 250));
    for (const select of [view.$category, view.$status]) select.addEventListener("change", view.reload);
    const published = async (record) => {
      store.invalidate("summary", "agents");
      await view.load();
      if (isCurrent()) openPackage(record.name, record.version, view.load, published);
    };
    const create = () =>
      filters.type === "templates"
        ? openTemplateEditor({ onPublished: published })
        : openPackageEditor({ template: TYPES[filters.type]?.create || "component", onPublished: published });
    delegate(actions, { create });
    delegate(root, catalogActions(view, create, published));
    await view.load();
    const requested = params.get("name");
    if (requested && isCurrent()) openPackage(requested, params.get("version"), view.load, published);
  },
};
