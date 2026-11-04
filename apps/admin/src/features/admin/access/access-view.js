import { can, store } from "../../../app/state.js";
import { del, get } from "../../../shared/lib/api.js";
import { delegate, html, mount } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { confirmDialog } from "../../../shared/ui/dialog.js";
import { errorState } from "../../../shared/ui/empty-state.js";
import { debounce } from "../../../shared/ui/format.js";
import { skeletonRows } from "../../../shared/ui/skeleton.js";
import { bindTabs } from "../../../shared/ui/tabs.js";
import { toast } from "../../../shared/ui/toast.js";
import { openKeyWizard } from "../../keys/key-wizard.js";
import { keyMatches, keysTable } from "./key-table.js";
import { bindTrustToggles, publisherForm, publishersTable } from "./publishers.js";

function layout() {
  return html`
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
      </div>`;
}

function revokeKey(key, onDone) {
  confirmDialog({
    title: `Revocar «${key.label}»`,
    message: "Los clientes que usen esta API key perderán el acceso de inmediato. No se puede deshacer.",
    confirmLabel: "Revocar API key",
    action: () => del(`/admin/api-keys/${encodeURIComponent(key.id)}`),
  }).then(async (ok) => {
    if (!ok) return;
    toast("API key revocada");
    await onDone();
  });
}

const tabActions = (tab) =>
  tab === "keys"
    ? html`<button class="btn primary" data-action="newKey">${icon("plus")}Nueva API key</button>`
    : html`<button class="btn primary" data-action="newPublisher">${icon("plus")}Registrar publicador</button>`;

export const accessView = {
  id: "access",
  label: "Accesos",
  icon: "key",
  title: "Accesos y API keys",
  subtitle:
    "Las API keys de las personas que administras (cada key pertenece a un usuario) y las claves de publicadores de confianza.",
  visible: () => can.manageKeys(),
  async render(root, { actions, isCurrent, params }) {
    const ownerFilter = params?.get("owner") || "";
    mount(root, layout());
    let keys = [];
    const loadPublishers = async () => {
      let publishers;
      try {
        publishers = (await get("/admin/publishers")).publishers;
      } catch (error) {
        mount(root.querySelector("#publisherResults"), errorState(error, "retryPublishers"));
        return;
      }
      mount(root.querySelector("#publisherResults"), publishersTable(publishers));
    };
    bindTabs(root, (selected) => {
      mount(actions, tabActions(selected));
      if (selected === "publishers") loadPublishers();
    });
    mount(actions, tabActions("keys"));
    const drawKeys = () => {
      const q = root.querySelector("#keySearch").value.trim().toLocaleLowerCase();
      const showRevoked = root.querySelector("#keyShowRevoked").checked;
      const list = keys.filter((k) => keyMatches(k, { q, showRevoked, ownerFilter }));
      mount(root.querySelector("#keyResults"), keysTable(list, { q, total: keys.length }));
    };
    const loadKeys = async () => {
      try {
        store.invalidate("organizations");
        keys = (await get("/admin/api-keys")).keys;
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#keyResults"), errorState(error));
        return;
      }
      if (isCurrent()) drawKeys();
    };
    root.querySelector("#keySearch").addEventListener("input", debounce(drawKeys));
    root.querySelector("#keyShowRevoked").addEventListener("change", drawKeys);
    const findKey = (button) => keys.find((k) => k.id === button.dataset.id);
    const handlers = {
      newKey: () =>
        openKeyWizard({ mode: "admin", owner: ownerFilter ? { id: ownerFilter } : undefined, onSaved: loadKeys }),
      editKey: (button) => {
        const key = findKey(button);
        if (key) openKeyWizard({ mode: "admin", key, onSaved: loadKeys });
      },
      revoke: (button) => {
        const key = findKey(button);
        if (key) revokeKey(key, loadKeys);
      },
      newPublisher: () => publisherForm(loadPublishers),
      retry: loadKeys,
      retryPublishers: loadPublishers,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    bindTrustToggles(root, loadPublishers);
    await loadKeys();
  },
};
