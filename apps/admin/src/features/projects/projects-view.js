import { can, store } from "../../app/state.js";
import { del } from "../../shared/lib/api.js";
import { delegate, html, mount } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { copyText } from "../../shared/ui/code-block.js";
import { confirmDialog } from "../../shared/ui/dialog.js";
import { errorState } from "../../shared/ui/empty-state.js";
import { debounce } from "../../shared/ui/format.js";
import { skeletonRows } from "../../shared/ui/skeleton.js";
import { toast } from "../../shared/ui/toast.js";
import { projectForm } from "./project-form.js";
import { matchesProject, organizationOptions, projectTable } from "./project-table.js";

function headerActions() {
  return html`${can.manageOrganizations() ? html`<a class="btn" href="#/organizations">${icon("layers")}Organizaciones</a>` : ""}${can.createProject() ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo proyecto</button>` : ""}`;
}

async function deleteProject(project, reload) {
  let result;
  const confirmed = await confirmDialog({
    title: "Eliminar proyecto",
    message: html`Se eliminará <b>${project.name}</b> junto con su memoria de proyecto y sesión, sus ejecuciones y el registro de paquetes instalados. Se quitará también de los accesos de usuarios y API keys. La memoria de organización se conserva. <b>No se puede deshacer.</b>`,
    confirmLabel: "Eliminar proyecto",
    typed: project.id,
    action: async () => {
      result = await del(`/projects/${encodeURIComponent(project.id)}`, { confirmation: project.id });
    },
  });
  if (!confirmed) return;
  toast(`Proyecto «${project.name}» eliminado (${result.memories} memorias, ${result.runs} ejecuciones)`);
  store.invalidate("projects");
  await reload();
}

function projectHandlers(ctx) {
  const find = (button) => ctx.projects.find((p) => p.id === button.dataset.id);
  const saved = async () => {
    store.invalidate("projects", "organizations");
    await ctx.load(true);
  };
  return {
    new: () =>
      projectForm(null, async (project) => {
        await saved();
        if (can.manageKeys()) ctx.navigate("connect", { params: { projectId: project.id } });
      }),
    edit: (button) => {
      const project = find(button);
      if (project) projectForm(project, saved);
    },
    delete: async (button) => {
      const project = find(button);
      if (project) await deleteProject(project, () => ctx.load(true));
    },
    copy: (button) => copyText(button.dataset.value),
    retry: () => ctx.load(true),
  };
}

export const projectsView = {
  id: "projects",
  label: "Proyectos",
  icon: "folder",
  title: "Proyectos",
  subtitle:
    "Cada sistema o repositorio (una API, una app web, una app móvil…): su memoria, sus tareas y los paquetes que instala.",
  async render(root, { actions, navigate, isCurrent, params }) {
    mount(actions, headerActions());
    mount(
      root,
      html`
      <div class="toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="projectSearch">Buscar proyectos</label><input id="projectSearch" type="search" placeholder="Buscar por nombre, identificador u organización…"></div>
        <label class="sr-only" for="projectOrgFilter">Organización</label><select id="projectOrgFilter"><option value="">Todas las organizaciones</option></select></div>
      <div class="panel" id="projectResults">${skeletonRows(5, 4)}</div>`,
    );
    const filter = root.querySelector("#projectOrgFilter");
    const ctx = { projects: [], navigate };
    const draw = () => {
      const q = root.querySelector("#projectSearch").value.trim().toLocaleLowerCase();
      const list = ctx.projects.filter((p) => matchesProject(p, q, filter.value));
      mount(root.querySelector("#projectResults"), projectTable(list, ctx.projects.length));
    };
    ctx.load = async (force) => {
      try {
        ctx.projects = await store.projects(force);
        mount(filter, organizationOptions(ctx.projects, filter.value || params?.get("organizationId") || ""));
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#projectResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#projectSearch").addEventListener("input", debounce(draw));
    filter.addEventListener("change", draw);
    const handlers = projectHandlers(ctx);
    delegate(root, handlers);
    delegate(actions, handlers);
    await ctx.load();
  },
};
