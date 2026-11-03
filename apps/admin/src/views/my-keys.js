import { del, get } from "../lib/api.js";
import { delegate, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { confirmDialog, emptyState, errorState, roleBadge, skeletonRows, timeTag, toast } from "../lib/ui.js";
import { state } from "../state.js";
import { keyAccess, openKeyWizard } from "./key-wizard.js";

export default {
  id: "my-keys",
  label: "Mis API keys",
  icon: "key",
  title: "Mis API keys",
  subtitle:
    "Credenciales para conectar la CLI, tu editor (MCP) o un worker en tu nombre. Nunca tienen más permisos que tu cuenta.",
  visible: () => Boolean(state.user),
  async render(root, { actions, isCurrent }) {
    mount(
      actions,
      html`<a class="btn" href="#/connect">${icon("link")}Conectar un equipo</a><button class="btn primary" data-action="new">${icon("plus")}Nueva API key</button>`,
    );
    mount(
      root,
      html`<div class="panel" id="myKeys">${skeletonRows(3, 4)}</div>
      <p class="hint">Si pierdes un equipo o se filtra un token, revoca su key: las demás siguen funcionando. Si a tu cuenta le quitan accesos o la desactivan, tus keys también los pierden.</p>`,
    );
    let keys = [];
    const draw = () => {
      const active = keys.filter((k) => !k.revokedAt);
      mount(
        root.querySelector("#myKeys"),
        active.length
          ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Nombre</th><th scope="col">Rol</th><th scope="col" class="hide-sm">Accesos</th><th scope="col" class="hide-sm">Último uso</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${active.map(
            (
              k,
            ) => html`<tr><td><b>${k.label}</b><div class="muted small">Creada ${timeTag(k.createdAt)}</div></td><td>${roleBadge(k.role)}</td><td class="hide-sm">${keyAccess(k)}</td><td class="hide-sm">${timeTag(k.lastUsedAt, "Sin uso")}</td>
            <td class="actions"><button type="button" class="btn small ghost danger-text" data-action="revoke" data-id="${k.id}">Revocar</button></td></tr>`,
          )}</tbody></table></div>`
          : emptyState({
              iconName: "key",
              title: "Aún no tienes API keys",
              text: "Crea una para cada equipo o programa que quieras conectar.",
              action: html`<button class="btn primary" data-action="new">${icon("plus")}Nueva API key</button>`,
            }),
      );
    };
    const load = async () => {
      try {
        keys = (await get("/me/api-keys")).keys;
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#myKeys"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    const handlers = {
      new: () => openKeyWizard({ mode: "self", onSaved: load }),
      revoke: (button) => {
        const key = keys.find((k) => k.id === button.dataset.id);
        if (!key) return;
        confirmDialog({
          title: "Revocar «" + key.label + "»",
          message: "El equipo o programa que la use perderá el acceso de inmediato. No se puede deshacer.",
          confirmLabel: "Revocar API key",
          action: () => del("/me/api-keys/" + encodeURIComponent(key.id)),
        }).then(async (ok) => {
          if (ok) {
            toast("API key revocada");
            await load();
          }
        });
      },
      retry: load,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
