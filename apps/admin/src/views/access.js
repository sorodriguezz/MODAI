import { del, get, patch, post } from "../lib/api.js";
import { delegate, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import {
  bindForm,
  bindTabs,
  closeDialog,
  codeBlock,
  confirmDialog,
  debounce,
  emptyState,
  errorState,
  openDialog,
  roleBadge,
  skeletonRows,
  timeTag,
  toast,
  toastError,
} from "../lib/ui.js";
import { can, store } from "../state.js";
import { keyAccess, openKeyWizard } from "./key-wizard.js";

export { showNewKey } from "./key-wizard.js";

function publisherForm(onSaved) {
  const body = openDialog({
    title: "Registrar publicador",
    description: "Las claves públicas Ed25519 permiten verificar la firma de los paquetes.",
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="pubLabel">Nombre</label><input id="pubLabel" required maxlength="200" placeholder="Equipo de plataforma"></div>
      <div class="field"><label for="pubKey">Clave pública (PEM)</label><textarea id="pubKey" class="mono" rows="6" required maxlength="4096" placeholder="-----BEGIN PUBLIC KEY-----"></textarea></div>
      <label class="checkbox"><input type="checkbox" id="pubTrusted" checked> Marcar como de confianza</label>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Registrar</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    await post("/admin/publishers", {
      label: form.pubLabel.value.trim(),
      publicKey: form.pubKey.value.trim(),
      trusted: form.pubTrusted.checked,
    });
    closeDialog();
    toast("Publicador registrado");
    await onSaved();
  });
}

export default {
  id: "access",
  label: "Accesos",
  icon: "key",
  title: "Accesos y API keys",
  subtitle:
    "Las API keys de las personas que administras (cada key pertenece a un usuario) y las claves de publicadores de confianza.",
  visible: () => can.manageKeys(),
  async render(root, { actions, isCurrent, params }) {
    const ownerFilter = params?.get("owner") || "";
    mount(
      root,
      html`
      <div class="tabs" role="tablist" aria-label="Tipo de acceso">
        <button role="tab" type="button" data-tab="keys" aria-selected="true">${icon("key", 16)}API keys</button>
        ${can.admin() ? html`<button role="tab" type="button" data-tab="publishers" aria-selected="false" tabindex="-1">${icon("shield", 16)}Publicadores</button>` : ""}
      </div>
      <div role="tabpanel" data-panel="keys" class="tab-panel">
        <div class="toolbar">
          <div class="search-field">${icon("search")}<label class="sr-only" for="keySearch">Buscar API keys</label><input id="keySearch" type="search" placeholder="Buscar por nombre…"></div>
          <label class="checkbox"><input type="checkbox" id="keyShowRevoked"> Mostrar revocadas</label>
        </div>
        <div class="panel" id="keyResults">${skeletonRows(4, 4)}</div>
        <p class="hint">Cada persona crea sus propias keys en <a href="#/my-keys">Mis API keys</a>, siempre dentro de sus permisos. Aquí ves y revocas las de quienes administras, o creas una a nombre de alguien (por ejemplo un usuario ci-bot para un worker).</p>
      </div>
      <div role="tabpanel" data-panel="publishers" class="tab-panel" hidden>
        <div class="panel" id="publisherResults">${skeletonRows(3, 3)}</div>
      </div>`,
    );
    let keys = [],
      publishers = [],
      tab = "keys";
    const setActions = () =>
      mount(
        actions,
        tab === "keys"
          ? html`<button class="btn primary" data-action="newKey">${icon("plus")}Nueva API key</button>`
          : html`<button class="btn primary" data-action="newPublisher">${icon("plus")}Registrar publicador</button>`,
      );
    bindTabs(root, (selected) => {
      tab = selected;
      setActions();
      if (selected === "publishers") loadPublishers();
    });
    setActions();
    const drawKeys = () => {
      const q = root.querySelector("#keySearch").value.trim().toLocaleLowerCase();
      const showRevoked = root.querySelector("#keyShowRevoked").checked;
      const list = keys.filter(
        (k) =>
          (showRevoked || !k.revokedAt) &&
          (!ownerFilter || k.ownerId === ownerFilter) &&
          (!q || [k.label, k.ownerName].join(" ").toLocaleLowerCase().includes(q)),
      );
      mount(
        root.querySelector("#keyResults"),
        list.length
          ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Nombre</th><th scope="col">Dueño</th><th scope="col">Rol</th><th scope="col" class="hide-sm">Accesos</th><th scope="col" class="hide-sm">Último uso</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map(
            (k) => html`<tr class="${k.revokedAt ? "is-disabled" : ""}">
            <td><b>${k.label}</b><div class="muted small">Creada ${timeTag(k.createdAt)}</div></td>
            <td>${k.ownerId ? html`<a href="#/access?owner=${encodeURIComponent(k.ownerId)}">@${k.ownerName}</a>` : html`<span class="muted">—</span>`}</td>
            <td>${roleBadge(k.role)}</td>
            <td class="hide-sm">${keyAccess(k)}</td>
            <td class="hide-sm">${timeTag(k.lastUsedAt, "Sin uso")}</td>
            <td>${k.revokedAt ? html`<span class="badge tone-danger"><span class="dot"></span>Revocada</span>` : html`<span class="badge tone-success"><span class="dot"></span>Activa</span>`}</td>
            <td class="actions">${k.revokedAt ? "" : html`<button type="button" class="btn small ghost" data-action="editKey" data-id="${k.id}">${icon("edit", 16)}<span class="hide-sm">${k.ownerId ? "Accesos" : "Asignar dueño"}</span></button><button type="button" class="btn small ghost danger-text" data-action="revoke" data-id="${k.id}">Revocar</button>`}</td>
          </tr>`,
          )}</tbody></table></div>`
          : q
            ? emptyState({ iconName: "search", title: "Sin coincidencias", text: "Prueba con otro nombre." })
            : emptyState({
                iconName: "key",
                title: keys.length ? "No hay API keys activas" : "Aún no hay API keys",
                text: keys.length
                  ? "Las revocadas siguen visibles con «Mostrar revocadas»."
                  : "Crea una credencial para cada cliente que use la CLI, MCP o un worker.",
                action: html`<button class="btn primary" data-action="newKey">${icon("plus")}Nueva API key</button>`,
              }),
      );
    };
    const loadKeys = async () => {
      try {
        // Member counts per organization change with every grant.
        store.invalidate("organizations");
        keys = (await get("/admin/api-keys")).keys;
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#keyResults"), errorState(error));
        return;
      }
      if (isCurrent()) drawKeys();
    };
    const loadPublishers = async () => {
      try {
        publishers = (await get("/admin/publishers")).publishers;
      } catch (error) {
        mount(root.querySelector("#publisherResults"), errorState(error, "retryPublishers"));
        return;
      }
      mount(
        root.querySelector("#publisherResults"),
        publishers.length
          ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Publicador</th><th scope="col">Huella</th><th scope="col">Confianza</th><th scope="col" class="hide-sm">Registrado</th></tr></thead>
          <tbody>${publishers.map(
            (p) => html`<tr>
            <td><b>${p.label || "Sin nombre"}</b></td>
            <td><code title="${p.fingerprint}">${p.fingerprint.slice(0, 20)}…</code></td>
            <td><label class="switch"><input type="checkbox" role="switch" data-action="trust" data-fingerprint="${p.fingerprint}" ${p.trusted ? "checked" : ""} aria-label="De confianza: ${p.label || p.fingerprint}"><span class="switch-track" aria-hidden="true"></span><span>${p.trusted ? "De confianza" : "No confiable"}</span></label></td>
            <td class="hide-sm">${timeTag(p.createdAt)}</td></tr>`,
          )}</tbody></table></div>`
          : emptyState({
              iconName: "shield",
              title: "Sin publicadores registrados",
              text: "Con la política de firmas «trusted» solo se aceptan paquetes firmados por publicadores de confianza.",
            }),
      );
    };
    root.querySelector("#keySearch").addEventListener("input", debounce(drawKeys));
    root.querySelector("#keyShowRevoked").addEventListener("change", drawKeys);
    const handlers = {
      newKey: () =>
        openKeyWizard({ mode: "admin", owner: ownerFilter ? { id: ownerFilter } : undefined, onSaved: loadKeys }),
      editKey: (button) => {
        const key = keys.find((k) => k.id === button.dataset.id);
        if (key) openKeyWizard({ mode: "admin", key, onSaved: loadKeys });
      },
      revoke: (button) => {
        const key = keys.find((k) => k.id === button.dataset.id);
        if (!key) return;
        confirmDialog({
          title: "Revocar «" + key.label + "»",
          message: "Los clientes que usen esta API key perderán el acceso de inmediato. No se puede deshacer.",
          confirmLabel: "Revocar API key",
          action: () => del("/admin/api-keys/" + encodeURIComponent(key.id)),
        }).then(async (ok) => {
          if (!ok) return;
          toast("API key revocada");
          await loadKeys();
        });
      },
      newPublisher: () => publisherForm(loadPublishers),
      retry: loadKeys,
      retryPublishers: loadPublishers,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    // Trust toggles use change events.
    root.addEventListener("change", async (event) => {
      const input = event.target.closest('[data-action="trust"]');
      if (!input) return;
      input.disabled = true;
      try {
        await patch("/admin/publishers/" + encodeURIComponent(input.dataset.fingerprint), { trusted: input.checked });
        toast(input.checked ? "Publicador marcado como de confianza" : "Confianza retirada");
        await loadPublishers();
      } catch (error) {
        input.checked = !input.checked;
        input.disabled = false;
        toastError(error);
      }
    });
    await loadKeys();
  },
};
