import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post, patch, del } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, confirmDialog, toast, skeletonRows, emptyState, errorState, debounce } from "../lib/ui.js";
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
  id: "namespaces",
  label: "Namespaces",
  icon: "package",
  title: "Namespaces",
  subtitle: "El prefijo @equipo/ de paquetes y templates. Cada uno pertenece a una organización, que decide quién publica en él.",
  visible: () => can.manageOrganizations(),
  async render(root, { actions, isCurrent }) {
    mount(root, html`
      <div class="callout tone-info">${icon("info")}<span>Un <b>namespace</b> debe existir antes de publicar en él: no se crea al publicar un paquete o template. Créalo aquí y asígnalo a una organización.</span></div>
      <div class="toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="nsSearch">Buscar namespaces</label><input id="nsSearch" type="search" placeholder="Buscar por nombre u organización…"></div></div>
      <div class="panel" id="nsResults">${skeletonRows(4, 4)}</div>`);
    let namespaces = [];
    mount(actions, html`<button class="btn primary" data-action="newNamespace">${icon("plus")}Nuevo namespace</button>`);

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
          : emptyState({ iconName: "package", title: "Aún no hay namespaces", text: "Crea uno por equipo o dominio. Hay que crear el namespace aquí antes de publicar paquetes o templates en él.", action: html`<button class="btn primary" data-action="newNamespace">${icon("plus")}Nuevo namespace</button>` }));
    };

    const load = async (force = false) => {
      try {
        namespaces = await store.namespaces(force);
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#nsResults"), errorState(error));
        return;
      }
      if (!isCurrent()) return;
      drawNamespaces();
    };
    const reload = async () => { store.invalidate("organizations", "namespaces", "projects"); await load(true); };
    root.querySelector("#nsSearch").addEventListener("input", debounce(drawNamespaces));

    const handlers = {
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
