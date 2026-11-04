import { can, store } from "../../app/state.js";
import { patch, post } from "../../shared/lib/api.js";
import { html } from "../../shared/lib/html.js";
import { closeDialog, openDialog } from "../../shared/ui/dialog.js";
import { bindForm } from "../../shared/ui/form.js";
import { toast } from "../../shared/ui/toast.js";

async function projectOrganizations() {
  const organizations = await store.organizations().catch(() => []);
  return can.admin() ? organizations : organizations.filter((o) => o.canManage || !can.manage());
}

function idField(project) {
  return project
    ? html`<div class="field"><label>Identificador</label><p><code>${project.id}</code></p></div>`
    : html`<div class="field"><label for="projectId">Identificador (opcional)</label><input id="projectId" maxlength="200" pattern="[A-Za-z0-9._:\\-]+" placeholder="portal-clientes" spellcheck="false"><p class="hint">Si lo dejas vacío se genera uno. Es el valor que usa <code>modai init --project</code>. No se puede cambiar después.</p></div>`;
}

function organizationSelect(project, organizations, required) {
  const first = required
    ? html`<option value="" disabled ${project?.organizationId ? "" : "selected"}>Elige una organización…</option>`
    : html`<option value="">Sin organización (personal)</option>`;
  return html`<select id="projectOrg" ${required ? "required" : ""}>
          ${first}
          ${organizations.map((o) => html`<option value="${o.id}" ${o.id === project?.organizationId ? "selected" : ""}>${o.name}</option>`)}
        </select>`;
}

async function saveProject(form, project) {
  const name = form.projectName.value.trim();
  const organizationId = form.projectOrg.value || undefined;
  if (project) {
    const payload = { name };
    if ((organizationId ?? null) !== (project.organizationId ?? null)) payload.organizationId = organizationId ?? null;
    return (await patch(`/projects/${encodeURIComponent(project.id)}`, payload)).project;
  }
  const payload = { name, ...(organizationId ? { organizationId } : {}) };
  if (form.projectId.value.trim()) payload.id = form.projectId.value.trim();
  return (await post("/projects", payload)).project;
}

export async function projectForm(project, onSaved) {
  const editing = Boolean(project);
  const organizations = await projectOrganizations();
  const required = !can.admin() && can.manage();
  const body = openDialog({
    title: editing ? `Editar ${project.name}` : "Nuevo proyecto",
    description:
      "Un proyecto es un sistema o repositorio (por ejemplo una API, una app web o una app móvil): agrupa su memoria, sus ejecuciones y los paquetes que instala.",
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="projectName">Nombre</label><input id="projectName" required maxlength="200" placeholder="Portal de clientes" value="${project?.name || ""}"></div>
      ${idField(project)}
      <div class="field"><label for="projectOrg">Organización</label>
        ${organizationSelect(project, organizations, required)}
        <p class="hint">Los proyectos de una organización comparten su memoria de organización y los administra quien administre la organización.</p></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar" : "Crear proyecto"}</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const saved = await saveProject(form, project);
    closeDialog();
    toast(editing ? "Proyecto actualizado" : `Proyecto «${saved.name}» creado`);
    await onSaved(saved);
  });
}
