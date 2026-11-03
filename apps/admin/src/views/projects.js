import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post, patch, del } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, confirmDialog, toast, skeletonRows, emptyState, errorState, timeTag, debounce, codeBlock, copyText } from "../lib/ui.js";
import { store, can } from "../state.js";

/** Organizations a project can live in: the ones the identity administers, or belongs to when it creates its own. */
async function projectOrganizations() {
  const organizations = await store.organizations().catch(() => []);
  return can.admin() ? organizations : organizations.filter((o) => o.canManage || !can.manage());
}

async function projectForm(project, onSaved) {
  const editing = Boolean(project);
  const organizations = await projectOrganizations();
  const required = !can.admin() && can.manage();
  const body = openDialog({
    title: editing ? "Editar " + project.name : "Nuevo proyecto",
    description: "Un proyecto es un sistema o repositorio (por ejemplo una API, una app web o una app móvil): agrupa su memoria, sus ejecuciones y los paquetes que instala.",
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="projectName">Nombre</label><input id="projectName" required maxlength="200" placeholder="Portal de clientes" value="${project?.name || ""}"></div>
      ${editing ? html`<div class="field"><label>Identificador</label><p><code>${project.id}</code></p></div>` : html`<div class="field"><label for="projectId">Identificador (opcional)</label><input id="projectId" maxlength="200" pattern="[A-Za-z0-9._:\\-]+" placeholder="portal-clientes" spellcheck="false"><p class="hint">Si lo dejas vacío se genera uno. Es el valor que usa <code>modai init --project</code>. No se puede cambiar después.</p></div>`}
      <div class="field"><label for="projectOrg">Organización</label>
        <select id="projectOrg" ${required ? "required" : ""}>
          ${required ? html`<option value="" disabled ${project?.organizationId ? "" : "selected"}>Elige una organización…</option>` : html`<option value="">Sin organización (personal)</option>`}
          ${organizations.map((o) => html`<option value="${o.id}" ${o.id === project?.organizationId ? "selected" : ""}>${o.name}</option>`)}
        </select>
        <p class="hint">Los proyectos de una organización comparten su memoria de organización y los administra quien administre la organización.</p></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar" : "Crear proyecto"}</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const name = form.projectName.value.trim(), organizationId = form.projectOrg.value || undefined;
    let saved;
    if (editing) {
      const payload = { name };
      if ((organizationId ?? null) !== (project.organizationId ?? null)) payload.organizationId = organizationId ?? null;
      saved = (await patch("/projects/" + encodeURIComponent(project.id), payload)).project;
    } else {
      const payload = { name, ...(organizationId ? { organizationId } : {}) };
      if (form.projectId.value.trim()) payload.id = form.projectId.value.trim();
      saved = (await post("/projects", payload)).project;
    }
    closeDialog();
    toast(editing ? "Proyecto actualizado" : "Proyecto «" + saved.name + "» creado");
    await onSaved(saved);
  });
}

export default {
  id: "projects",
  label: "Proyectos",
  icon: "folder",
  title: "Proyectos",
  subtitle: "Cada sistema o repositorio (una API, una app web, una app móvil…): su memoria, sus tareas y los paquetes que instala.",
  async render(root, { actions, navigate, isCurrent, params }) {
    mount(actions, html`${can.manageOrganizations() ? html`<a class="btn" href="#/organizations">${icon("layers")}Organizaciones</a>` : ""}${can.createProject() ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo proyecto</button>` : ""}`);
    mount(root, html`
      <div class="toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="projectSearch">Buscar proyectos</label><input id="projectSearch" type="search" placeholder="Buscar por nombre, identificador u organización…"></div>
        <label class="sr-only" for="projectOrgFilter">Organización</label><select id="projectOrgFilter"><option value="">Todas las organizaciones</option></select></div>
      <div class="panel" id="projectResults">${skeletonRows(5, 4)}</div>`);
    let projects = [];
    const draw = () => {
      const q = root.querySelector("#projectSearch").value.trim().toLocaleLowerCase();
      const org = root.querySelector("#projectOrgFilter").value;
      const list = projects.filter((p) => (!org || (org === "none" ? !p.organizationId : p.organizationId === org)) && (!q || [p.name, p.id, p.organizationName].join(" ").toLocaleLowerCase().includes(q)));
      mount(root.querySelector("#projectResults"), list.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Proyecto</th><th scope="col">Identificador</th><th scope="col" class="hide-sm">Organización</th><th scope="col" class="hide-sm">Creado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map((p) => html`<tr>
            <td><b>${p.name}</b></td>
            <td><span class="inline-copy"><code>${p.id}</code><button type="button" class="icon-button small" data-action="copy" data-value="${p.id}" aria-label="Copiar identificador ${p.id}">${icon("copy", 16)}</button></span></td>
            <td class="hide-sm">${p.organizationId ? (p.organizationName || html`<code>${p.organizationId}</code>`) : html`<span class="muted">Personal</span>`}</td>
            <td class="hide-sm">${timeTag(p.createdAt)}</td>
            <td class="actions">
              <a class="btn small ghost" href="#/memories?projectId=${encodeURIComponent(p.id)}">${icon("brain", 16)}Memoria</a>
              <a class="btn small ghost" href="#/runs?projectId=${encodeURIComponent(p.id)}">${icon("play", 16)}Ejecuciones</a>
              ${can.manageKeys() ? html`<a class="btn small ghost" href="#/connect?projectId=${encodeURIComponent(p.id)}">${icon("link", 16)}Dar acceso</a>` : ""}
              ${p.canEdit ? html`<button type="button" class="icon-button small" data-action="edit" data-id="${p.id}" aria-label="Editar el proyecto ${p.name}" title="Editar proyecto">${icon("edit", 16)}</button>` : ""}
              ${p.canDelete ? html`<button type="button" class="icon-button small danger" data-action="delete" data-id="${p.id}" aria-label="Eliminar el proyecto ${p.name} (${p.id})" title="Eliminar proyecto">${icon("trash", 16)}</button>` : ""}
            </td></tr>`)}</tbody></table></div>`
        : projects.length ? emptyState({ iconName: "search", title: "Sin coincidencias" })
          : emptyState({ iconName: "folder", title: "No tienes proyectos", text: can.createProject() ? "Crea uno para guardar memoria y enviar tareas." : "Pide a la administración que te asigne un proyecto.", action: can.createProject() ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo proyecto</button>` : "" }));
    };
    const load = async (force) => {
      try {
        projects = await store.projects(force);
        const filter = root.querySelector("#projectOrgFilter"), selected = filter.value || params?.get("organizationId") || "";
        const organizations = [...new Map(projects.filter((p) => p.organizationId).map((p) => [p.organizationId, p.organizationName || p.organizationId])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
        mount(filter, html`<option value="">Todas las organizaciones</option>${organizations.map(([id, name]) => html`<option value="${id}" ${id === selected ? "selected" : ""}>${name}</option>`)}${projects.some((p) => !p.organizationId) ? html`<option value="none" ${selected === "none" ? "selected" : ""}>Sin organización</option>` : ""}`);
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#projectResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#projectSearch").addEventListener("input", debounce(draw));
    root.querySelector("#projectOrgFilter").addEventListener("change", draw);
    const handlers = {
      new: () => projectForm(null, async (project) => {
        store.invalidate("projects", "organizations");
        await load(true);
        if (can.manageKeys()) navigate("connect", { params: { projectId: project.id } });
      }),
      edit: (button) => {
        const project = projects.find((p) => p.id === button.dataset.id);
        if (project) projectForm(project, async () => { store.invalidate("projects", "organizations"); await load(true); });
      },
      delete: async (button) => {
        const project = projects.find((p) => p.id === button.dataset.id);
        if (!project) return;
        let result;
        const confirmed = await confirmDialog({
          title: "Eliminar proyecto",
          message: html`Se eliminará <b>${project.name}</b> junto con su memoria de proyecto y sesión, sus ejecuciones y el registro de paquetes instalados. Se quitará también de los accesos de usuarios y API keys. La memoria de organización se conserva. <b>No se puede deshacer.</b>`,
          confirmLabel: "Eliminar proyecto",
          typed: project.id,
          action: async () => { result = await del(`/projects/${encodeURIComponent(project.id)}`, { confirmation: project.id }); },
        });
        if (!confirmed) return;
        toast(`Proyecto «${project.name}» eliminado (${result.memories} memorias, ${result.runs} ejecuciones)`);
        store.invalidate("projects");
        await load(true);
      },
      copy: (button) => copyText(button.dataset.value),
      retry: () => load(true),
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
