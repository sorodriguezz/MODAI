import { state } from "../../app/state.js";
import { del, get } from "../../shared/lib/api.js";
import { delegate, html, mount } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { confirmDialog } from "../../shared/ui/dialog.js";
import { emptyState, loadOrShowError } from "../../shared/ui/empty-state.js";
import { timeTag } from "../../shared/ui/format.js";
import { roleBadge } from "../../shared/ui/labels.js";
import { skeletonRows } from "../../shared/ui/skeleton.js";
import { actionsColumn, dataTable, optionalColumn } from "../../shared/ui/table.js";
import { toast } from "../../shared/ui/toast.js";
import { keyAccess, openKeyWizard } from "./key-wizard.js";

export const myKeysView = {
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
          ? dataTable(
              ["Nombre", "Rol", optionalColumn("Accesos"), optionalColumn("Último uso"), actionsColumn()],
              active.map(
                (
                  k,
                ) => html`<tr><td><b>${k.label}</b><div class="muted small">Creada ${timeTag(k.createdAt)}</div></td><td>${roleBadge(k.role)}</td><td class="hide-sm">${keyAccess(k)}</td><td class="hide-sm">${timeTag(k.lastUsedAt, "Sin uso")}</td>
            <td class="actions"><button type="button" class="btn small ghost danger-text" data-action="revoke" data-id="${k.id}">Revocar</button></td></tr>`,
              ),
            )
          : emptyState({
              iconName: "key",
              title: "Aún no tienes API keys",
              text: "Crea una para cada equipo o programa que quieras conectar.",
              action: html`<button class="btn primary" data-action="new">${icon("plus")}Nueva API key</button>`,
            }),
      );
    };
    const load = async () => {
      const result = await loadOrShowError(root.querySelector("#myKeys"), isCurrent, () => get("/me/api-keys"));
      if (!result) return;
      keys = result.keys;
      draw();
    };
    const handlers = {
      new: () => openKeyWizard({ mode: "self", onSaved: load }),
      revoke: (button) => {
        const key = keys.find((k) => k.id === button.dataset.id);
        if (!key) return;
        confirmDialog({
          title: `Revocar «${key.label}»`,
          message: "El equipo o programa que la use perderá el acceso de inmediato. No se puede deshacer.",
          confirmLabel: "Revocar API key",
          action: () => del(`/me/api-keys/${encodeURIComponent(key.id)}`),
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
