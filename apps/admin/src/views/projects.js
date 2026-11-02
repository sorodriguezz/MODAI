import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, toast, skeletonRows, emptyState, errorState, timeTag, debounce, codeBlock, copyText } from "../lib/ui.js";
import { store, can } from "../state.js";

function newProject(onCreated) {
  const body = openDialog({
    title: "Nuevo proyecto",
    description: "Un proyecto agrupa memoria y ejecuciones. Después podrás dar acceso a personas o clientes.",
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="projectName">Nombre</label><input id="projectName" required maxlength="200" placeholder="Portal de clientes"></div>
      <div class="field"><label for="projectId">Identificador (opcional)</label><input id="projectId" maxlength="200" pattern="[A-Za-z0-9._:\\-]+" placeholder="portal-clientes" spellcheck="false"><p class="hint">Si lo dejas vacío se genera uno. Es el valor que usa <code>modai init --project</code>.</p></div>
      <div class="field"><label for="projectOrg">ID de organización (opcional)</label><input id="projectOrg" maxlength="200" spellcheck="false"><p class="hint">Permite compartir memoria de organización entre proyectos.</p></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Crear proyecto</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const payload = { name: form.projectName.value.trim() };
    if (form.projectId.value.trim()) payload.id = form.projectId.value.trim();
    if (form.projectOrg.value.trim()) payload.organizationId = form.projectOrg.value.trim();
    const { project } = await post("/projects", payload);
    closeDialog();
    toast("Proyecto «" + project.name + "» creado");
    await onCreated(project);
  });
}

function newOrganization() {
  const body = openDialog({
    title: "Nueva organización",
    description: "Las organizaciones permiten memoria compartida entre varios proyectos.",
    size: "sm",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="orgName">Nombre</label><input id="orgName" required maxlength="200"></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Crear organización</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const { organization } = await post("/admin/organizations", { name: form.orgName.value.trim() });
    openDialog({
      title: "Organización creada",
      size: "sm",
      body: html`<p>Usa este identificador al crear proyectos o al asignar permisos a usuarios y API keys.</p>${codeBlock("orgId", organization.id)}<div class="dialog-actions"><button type="button" class="btn primary" data-close>Listo</button></div>`,
    }).querySelector("[data-close]").addEventListener("click", closeDialog);
  });
}

export default {
  id: "projects",
  label: "Proyectos",
  icon: "folder",
  title: "Proyectos",
  subtitle: "Espacios de memoria y ejecución a los que tienes acceso.",
  async render(root, { actions, navigate, isCurrent }) {
    mount(actions, html`${can.admin() ? html`<button class="btn" data-action="org">${icon("layers")}Nueva organización</button>` : ""}${can.createProject() ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo proyecto</button>` : ""}`);
    mount(root, html`
      <div class="toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="projectSearch">Buscar proyectos</label><input id="projectSearch" type="search" placeholder="Buscar por nombre, identificador u organización…"></div></div>
      <div class="panel" id="projectResults">${skeletonRows(5, 4)}</div>`);
    let projects = [];
    const draw = () => {
      const q = root.querySelector("#projectSearch").value.trim().toLocaleLowerCase();
      const list = projects.filter((p) => !q || [p.name, p.id, p.organizationId].join(" ").toLocaleLowerCase().includes(q));
      mount(root.querySelector("#projectResults"), list.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Proyecto</th><th scope="col">Identificador</th><th scope="col" class="hide-sm">Organización</th><th scope="col" class="hide-sm">Creado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map((p) => html`<tr>
            <td><b>${p.name}</b></td>
            <td><span class="inline-copy"><code>${p.id}</code><button type="button" class="icon-button small" data-action="copy" data-value="${p.id}" aria-label="Copiar identificador ${p.id}">${icon("copy", 16)}</button></span></td>
            <td class="hide-sm">${p.organizationId ? html`<code>${p.organizationId}</code>` : html`<span class="muted">Personal</span>`}</td>
            <td class="hide-sm">${timeTag(p.createdAt)}</td>
            <td class="actions">
              <a class="btn small ghost" href="#/memories?projectId=${encodeURIComponent(p.id)}">${icon("brain", 16)}Memoria</a>
              <a class="btn small ghost" href="#/runs?projectId=${encodeURIComponent(p.id)}">${icon("play", 16)}Ejecuciones</a>
              ${can.admin() ? html`<a class="btn small ghost" href="#/connect?projectId=${encodeURIComponent(p.id)}">${icon("link", 16)}Dar acceso</a>` : ""}
            </td></tr>`)}</tbody></table></div>`
        : projects.length ? emptyState({ iconName: "search", title: "Sin coincidencias" })
          : emptyState({ iconName: "folder", title: "No tienes proyectos", text: can.createProject() ? "Crea uno para guardar memoria y enviar tareas." : "Pide a la administración que te asigne un proyecto.", action: can.createProject() ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo proyecto</button>` : "" }));
    };
    const load = async (force) => {
      try {
        projects = await store.projects(force);
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#projectResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#projectSearch").addEventListener("input", debounce(draw));
    const handlers = {
      new: () => newProject(async (project) => {
        store.invalidate("projects");
        await load(true);
        if (can.admin()) navigate("connect", { params: { projectId: project.id } });
      }),
      org: () => newOrganization(),
      copy: (button) => copyText(button.dataset.value),
      retry: () => load(true),
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
