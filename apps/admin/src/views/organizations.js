import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post, patch, del } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, confirmDialog, toast, skeletonRows, emptyState, errorState, timeTag, debounce, bindTabs } from "../lib/ui.js";
import { store, can } from "../state.js";

const visibilityLabels = { internal: "Interno", restricted: "Restringido" };
const visibilityHints = {
  internal: "Cualquier persona o API key autenticada ve e instala sus paquetes.",
  restricted: "Solo quien tenga este namespace asignado (o administre su organización) ve sus paquetes.",
};

/** Organizations the current identity may choose as owner. Global admins see all of them. */
async function ownerOptions() {
  const organizations = await store.organizations();
  return organizations.filter((o) => o.canManage);
}

function organizationSelect(id, organizations, selected, { allowNone = can.admin() } = {}) {
  return html`<select id="${id}" ${allowNone ? "" : "required"}>
    ${allowNone ? html`<option value="">Sin organización (solo administración global)</option>` : html`<option value="" disabled ${selected ? "" : "selected"}>Elige una organización…</option>`}
    ${organizations.map((o) => html`<option value="${o.id}" ${o.id === selected ? "selected" : ""}>${o.name}</option>`)}
  </select>`;
}

function organizationForm(organization, onSaved) {
  const editing = Boolean(organization);
  const body = openDialog({
    title: editing ? "Editar " + organization.name : "Nueva organización",
    description: "Una organización agrupa proyectos (por ejemplo las de un equipo o un área) y es dueña de namespaces de paquetes.",
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

async function namespaceForm(namespace, onSaved) {
  const editing = Boolean(namespace);
  const owners = await ownerOptions();
  const body = openDialog({
    title: editing ? "Namespace " + namespace.name : "Nuevo namespace",
    description: "Un namespace es el prefijo de los paquetes (@equipo/paquete). Pertenece a una organización, que decide quién publica en él.",
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="nsName">Nombre</label><input id="nsName" required maxlength="65" pattern="@[a-z0-9][a-z0-9._\\-]{0,63}" spellcheck="false" autocapitalize="off" value="${namespace?.name || "@"}" ${editing ? "disabled" : ""}><p class="hint">Empieza con @, en minúsculas. No se puede renombrar después.</p></div>
      <div class="field"><label for="nsOrganization">Organización dueña</label>${organizationSelect("nsOrganization", owners, namespace?.organizationId)}</div>
      <fieldset class="field"><legend>Visibilidad</legend><div class="role-options">${Object.entries(visibilityLabels).map(([value, label]) => html`<label class="role-option"><input type="radio" name="nsVisibility" value="${value}" ${value === (namespace?.visibility || "internal") ? "checked" : ""}><span><b>${label}</b><span class="muted small">${visibilityHints[value]}</span></span></label>`)}</div></fieldset>
      <div class="field"><label for="nsDescription">Descripción (opcional)</label><textarea id="nsDescription" rows="2" maxlength="1000">${namespace?.description || ""}</textarea></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar" : "Crear namespace"}</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const payload = { organizationId: form.nsOrganization.value || null, visibility: form.querySelector('input[name="nsVisibility"]:checked').value, description: form.nsDescription.value.trim() };
    if (editing) await patch("/namespaces/" + encodeURIComponent(namespace.name), payload);
    else await post("/namespaces", { ...payload, name: form.nsName.value.trim().toLowerCase(), organizationId: payload.organizationId || undefined });
    closeDialog();
    toast(editing ? "Namespace actualizado" : "Namespace creado");
    await onSaved();
  });
}

export default {
  id: "organizations",
  label: "Organizaciones",
  icon: "layers",
  title: "Organizaciones y namespaces",
  subtitle: "La jerarquía de acceso: organización → proyectos → namespaces → paquetes.",
  visible: () => can.manageOrganizations(),
  async render(root, { actions, isCurrent }) {
    mount(root, html`
      <div class="callout tone-info">${icon("info")}<span>Una <b>organización</b> agrupa <b>proyectos</b> (cada sistema o repositorio, por ejemplo una API o una app web) y es dueña de <b>namespaces</b>, el prefijo <code>@equipo/</code> de sus paquetes. Al dar acceso a una persona se elige en ese orden: organización, luego proyectos, luego namespaces.</span></div>
      <div class="tabs" role="tablist" aria-label="Directorio">
        <button role="tab" type="button" data-tab="organizations" aria-selected="true">${icon("layers", 16)}Organizaciones</button>
        <button role="tab" type="button" data-tab="namespaces" aria-selected="false" tabindex="-1">${icon("package", 16)}Namespaces</button>
      </div>
      <div role="tabpanel" data-panel="organizations" class="tab-panel"><div class="panel" id="orgResults">${skeletonRows(4, 4)}</div></div>
      <div role="tabpanel" data-panel="namespaces" class="tab-panel" hidden>
        <div class="toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="nsSearch">Buscar namespaces</label><input id="nsSearch" type="search" placeholder="Buscar por nombre u organización…"></div></div>
        <div class="panel" id="nsResults">${skeletonRows(4, 4)}</div>
      </div>`);
    let organizations = [], namespaces = [], tab = "organizations";
    const setActions = () => mount(actions, tab === "organizations"
      ? (can.createOrganizations() ? html`<button class="btn primary" data-action="newOrg">${icon("plus")}Nueva organización</button>` : "")
      : html`<button class="btn primary" data-action="newNamespace">${icon("plus")}Nuevo namespace</button>`);
    bindTabs(root, (selected) => { tab = selected; setActions(); });
    setActions();

    const drawOrganizations = () => mount(root.querySelector("#orgResults"), organizations.length
      ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Organización</th><th scope="col">Proyectos</th><th scope="col">Namespaces</th><th scope="col" class="hide-sm">Miembros</th><th scope="col" class="hide-sm">Creada</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${organizations.map((o) => html`<tr>
          <td><b>${o.name}</b>${o.description ? html`<div class="muted small">${o.description}</div>` : ""}</td>
          <td><a href="#/projects?organizationId=${encodeURIComponent(o.id)}">${o.projects}</a></td>
          <td>${o.namespaces}</td>
          <td class="hide-sm">${o.members}</td>
          <td class="hide-sm">${timeTag(o.createdAt)}</td>
          <td class="actions">${o.canManage ? html`<button type="button" class="btn small ghost" data-action="editOrg" data-id="${o.id}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>` : ""}
            ${can.createOrganizations() ? html`<button type="button" class="icon-button small danger" data-action="deleteOrg" data-id="${o.id}" aria-label="Eliminar ${o.name}" title="${o.projects || o.namespaces ? "Mueve o elimina sus proyectos y namespaces antes" : "Eliminar"}" ${o.projects || o.namespaces ? "disabled" : ""}>${icon("trash", 16)}</button>` : ""}</td>
        </tr>`)}</tbody></table></div>`
      : emptyState({ iconName: "layers", title: "Aún no hay organizaciones", text: can.createOrganizations() ? "Crea la primera para agrupar proyectos y namespaces." : "Pide a la administración global que te asigne una.", action: can.createOrganizations() ? html`<button class="btn primary" data-action="newOrg">${icon("plus")}Nueva organización</button>` : "" }));

    const drawNamespaces = () => {
      const q = root.querySelector("#nsSearch").value.trim().toLocaleLowerCase();
      const list = namespaces.filter((n) => !q || [n.name, n.organizationName, n.description].join(" ").toLocaleLowerCase().includes(q));
      mount(root.querySelector("#nsResults"), list.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Namespace</th><th scope="col">Organización</th><th scope="col">Visibilidad</th><th scope="col" class="hide-sm">Paquetes</th><th scope="col" class="hide-sm">Puedes publicar</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map((n) => html`<tr>
            <td><code>${n.name}</code>${n.description ? html`<div class="muted small">${n.description}</div>` : ""}</td>
            <td>${n.organizationName || html`<span class="muted">Sin organización</span>`}</td>
            <td><span class="badge ${n.visibility === "restricted" ? "tone-warning" : ""}" title="${visibilityHints[n.visibility]}">${visibilityLabels[n.visibility]}</span></td>
            <td class="hide-sm"><a href="#/packages?q=${encodeURIComponent(n.name + "/")}">${n.packages}</a></td>
            <td class="hide-sm">${n.canPublish ? "Sí" : html`<span class="muted">No</span>`}</td>
            <td class="actions">${n.canManage ? html`<button type="button" class="btn small ghost" data-action="editNamespace" data-name="${n.name}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>
              <button type="button" class="icon-button small danger" data-action="deleteNamespace" data-name="${n.name}" aria-label="Eliminar ${n.name}" title="${n.packages ? "Tiene paquetes publicados" : "Eliminar"}" ${n.packages ? "disabled" : ""}>${icon("trash", 16)}</button>` : ""}</td>
          </tr>`)}</tbody></table></div>`
        : namespaces.length ? emptyState({ iconName: "search", title: "Sin coincidencias" })
          : emptyState({ iconName: "package", title: "Aún no hay namespaces", text: "Crea uno por equipo o dominio. Los namespaces también se registran solos al publicar el primer paquete.", action: html`<button class="btn primary" data-action="newNamespace">${icon("plus")}Nuevo namespace</button>` }));
    };

    const load = async (force = false) => {
      try {
        [organizations, namespaces] = await Promise.all([store.organizations(force), store.namespaces(force)]);
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#orgResults"), errorState(error));
        return;
      }
      if (!isCurrent()) return;
      drawOrganizations();
      drawNamespaces();
    };
    const reload = async () => { store.invalidate("organizations", "namespaces", "projects"); await load(true); };
    root.querySelector("#nsSearch").addEventListener("input", debounce(drawNamespaces));

    const handlers = {
      newOrg: () => organizationForm(null, reload),
      editOrg: (button) => { const o = organizations.find((item) => item.id === button.dataset.id); if (o) organizationForm(o, reload); },
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
        if (ok) { toast("Organización eliminada"); await reload(); }
      },
      newNamespace: () => namespaceForm(null, reload),
      editNamespace: (button) => { const n = namespaces.find((item) => item.name === button.dataset.name); if (n) namespaceForm(n, reload); },
      deleteNamespace: async (button) => {
        const n = namespaces.find((item) => item.name === button.dataset.name);
        if (!n) return;
        const ok = await confirmDialog({
          title: "Eliminar namespace",
          message: html`Se eliminará <code>${n.name}</code> y se quitará de los accesos que lo tengan asignado.`,
          confirmLabel: "Eliminar namespace",
          action: () => del("/namespaces/" + encodeURIComponent(n.name)),
        });
        if (ok) { toast("Namespace eliminado"); await reload(); }
      },
      retry: () => load(true),
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
