import { can, store } from "../../app/state.js";
import { get } from "../../shared/lib/api.js";
import { delegate, html, mount } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { errorState } from "../../shared/ui/empty-state.js";
import { debounce } from "../../shared/ui/format.js";
import { skeletonRows } from "../../shared/ui/skeleton.js";
import { documentEditor } from "./document-editor.js";
import { documentMeta, documentTable, matchesDocument } from "./document-table.js";
import { documentViewer } from "./document-viewer.js";

export const knowledgeView = {
  id: "knowledge",
  label: "Conocimiento",
  icon: "book",
  title: "Conocimiento",
  subtitle: "Guías de tus paquetes y lo que tu equipo aprende, disponibles para cualquier agente.",
  async render(root, { actions, isCurrent }) {
    mount(
      root,
      html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="docSearch">Buscar conocimiento</label><input id="docSearch" type="search" placeholder="Buscar en títulos, contenido y etiquetas…"></div>
        <label class="sr-only" for="docProject">Ámbito</label><select id="docProject"><option value="">Catálogo</option></select>
        <label class="sr-only" for="docOrigin">Origen</label><select id="docOrigin"><option value="">Todos los orígenes</option><option value="manual">Documentos manuales</option><option value="package">De paquetes</option></select>
      </div>
      <p class="results-meta" id="docMeta" aria-live="polite"></p>
      <div class="panel" id="docResults">${skeletonRows(6, 3)}</div>`,
    );
    let documents = [],
      projects = [],
      loadId = 0;
    const scope = root.querySelector("#docProject");
    const currentProject = () => projects.find((project) => project.id === scope.value);
    const draw = () => {
      const q = root.querySelector("#docSearch").value.trim().toLocaleLowerCase();
      const origin = root.querySelector("#docOrigin").value;
      const list = documents.filter((d) => matchesDocument(d, q, origin));
      root.querySelector("#docMeta").textContent = documentMeta(list, documents);
      mount(root.querySelector("#docResults"), documentTable(list, documents.length, currentProject()));
    };
    const load = async (force) => {
      const id = ++loadId;
      const project = currentProject();
      const current = () => isCurrent() && loadId === id;
      const editable = project ? can.createProject() : can.createKnowledge();
      const origin = root.querySelector("#docOrigin");
      origin.disabled = Boolean(project);
      if (project) origin.value = "";
      documents = [];
      mount(
        actions,
        editable ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo documento</button>` : "",
      );
      mount(root.querySelector("#docResults"), skeletonRows(6, 3));
      try {
        const results = project
          ? (await get(`/projects/${encodeURIComponent(project.id)}/knowledge/documents?limit=500`)).documents
          : await store.documents(force);
        if (!current()) return;
        documents = results;
      } catch (error) {
        if (current()) mount(root.querySelector("#docResults"), errorState(error));
        return;
      }
      draw();
    };
    const reload = async () => {
      store.invalidate("documents");
      await load();
    };
    root.querySelector("#docSearch").addEventListener("input", debounce(draw));
    root.querySelector("#docOrigin").addEventListener("change", draw);
    scope.addEventListener("change", () => void load());
    const handlers = {
      new: () => documentEditor(null, reload, currentProject()),
      view: (button) => {
        const record = documents.find((d) => d.id === button.dataset.id);
        if (record) documentViewer(record, reload, currentProject());
      },
      retry: () => load(true),
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    projects = await store.projects().catch(() => []);
    if (!isCurrent()) return;
    mount(
      scope,
      html`<option value="">Catálogo</option>${projects.map((project) => html`<option value="${project.id}">${project.name}</option>`)}`,
    );
    await load();
  },
};
