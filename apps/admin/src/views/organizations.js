import { del, patch, post } from "../lib/api.js";
import { delegate, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import {
  bindForm,
  closeDialog,
  confirmDialog,
  emptyState,
  errorState,
  openDialog,
  skeletonRows,
  timeTag,
  toast,
} from "../lib/ui.js";
import { can, store } from "../state.js";

function organizationForm(organization, onSaved) {
  const editing = Boolean(organization);
  const body = openDialog({
    title: editing ? "Editar " + organization.name : "Nueva organización",
    description:
      "Una organización agrupa proyectos (por ejemplo las de un equipo o un área) y es dueña de namespaces de paquetes.",
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="orgName">Nombre</label><input id="orgName" required maxlength="200" value="${organization?.name || ""}" placeholder="Acme Pagos"></div>
      <div class="field"><label for="orgDescription">Descripción (opcional)</label><textarea id="orgDescription" rows="3" maxlength="1000" placeholder="Qué equipo o área representa">${organization?.description || ""}</textarea></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar" : "Crear organización"}</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const payload = { name: form.orgName.value.trim(), description: form.orgDescription.value.trim() };
    if (editing) await patch("/organizations/" + encodeURIComponent(organization.id), payload);
    else await post("/organizations", payload);
    closeDialog();
    toast(editing ? "Organización actualizada" : "Organización «" + payload.name + "» creada");
    await onSaved();
  });
}

export default {
  id: "organizations",
  label: "Organizaciones",
  icon: "layers",
  title: "Organizaciones",
  subtitle: "La jerarquía de acceso: organización → proyectos → namespaces → paquetes.",
  visible: () => can.manageOrganizations(),
  async render(root, { actions, isCurrent }) {
    mount(
      root,
      html`
      <div class="callout tone-info">${icon("info")}<span>Una <b>organización</b> agrupa <b>proyectos</b> (cada sistema o repositorio, por ejemplo una API o una app web) y es dueña de <b>namespaces</b>, el prefijo <code>@equipo/</code> de sus paquetes, que se gestionan en su propio menú. Al dar acceso a una persona se elige en ese orden: organización, luego proyectos, luego namespaces.</span></div>
      <div class="panel" id="orgResults">${skeletonRows(4, 4)}</div>`,
    );
    let organizations = [];
    mount(
      actions,
      can.createOrganizations()
        ? html`<button class="btn primary" data-action="newOrg">${icon("plus")}Nueva organización</button>`
        : "",
    );

    const drawOrganizations = () =>
      mount(
        root.querySelector("#orgResults"),
        organizations.length
          ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Organización</th><th scope="col">Proyectos</th><th scope="col">Namespaces</th><th scope="col" class="hide-sm">Miembros</th><th scope="col" class="hide-sm">Creada</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${organizations.map(
          (o) => html`<tr>
          <td><b>${o.name}</b>${o.description ? html`<div class="muted small">${o.description}</div>` : ""}</td>
          <td><a href="#/projects?organizationId=${encodeURIComponent(o.id)}">${o.projects}</a></td>
          <td>${o.namespaces}</td>
          <td class="hide-sm">${o.members}</td>
          <td class="hide-sm">${timeTag(o.createdAt)}</td>
          <td class="actions">${o.canManage ? html`<button type="button" class="btn small ghost" data-action="editOrg" data-id="${o.id}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>` : ""}
            ${can.createOrganizations() ? html`<button type="button" class="icon-button small danger" data-action="deleteOrg" data-id="${o.id}" aria-label="Eliminar ${o.name}" title="${o.projects || o.namespaces ? "Mueve o elimina sus proyectos y namespaces antes" : "Eliminar"}" ${o.projects || o.namespaces ? "disabled" : ""}>${icon("trash", 16)}</button>` : ""}</td>
        </tr>`,
        )}</tbody></table></div>`
          : emptyState({
              iconName: "layers",
              title: "Aún no hay organizaciones",
              text: can.createOrganizations()
                ? "Crea la primera para agrupar proyectos y namespaces."
                : "Pide a la administración global que te asigne una.",
              action: can.createOrganizations()
                ? html`<button class="btn primary" data-action="newOrg">${icon("plus")}Nueva organización</button>`
                : "",
            }),
      );

    const load = async (force = false) => {
      try {
        organizations = await store.organizations(force);
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#orgResults"), errorState(error));
        return;
      }
      if (!isCurrent()) return;
      drawOrganizations();
    };
    const reload = async () => {
      store.invalidate("organizations", "namespaces", "projects");
      await load(true);
    };

    const handlers = {
      newOrg: () => organizationForm(null, reload),
      editOrg: (button) => {
        const o = organizations.find((item) => item.id === button.dataset.id);
        if (o) organizationForm(o, reload);
      },
      deleteOrg: async (button) => {
        const o = organizations.find((item) => item.id === button.dataset.id);
        if (!o) return;
        const ok = await confirmDialog({
          title: "Eliminar organización",
          message: html`Se eliminará <b>${o.name}</b> y se quitará de los accesos de usuarios y API keys. Su memoria de organización queda sin organización.`,
          confirmLabel: "Eliminar organización",
          typed: o.name,
          action: () => del("/organizations/" + encodeURIComponent(o.id), { confirmation: o.name }),
        });
        if (ok) {
          toast("Organización eliminada");
          await reload();
        }
      },
      retry: () => load(true),
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
