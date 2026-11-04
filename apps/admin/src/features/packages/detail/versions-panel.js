import { can } from "../../../app/state.js";
import { del, post } from "../../../shared/lib/api.js";
import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { confirmDialog, promptDialog } from "../../../shared/ui/dialog.js";
import { timeTag } from "../../../shared/ui/format.js";
import { statusBadge } from "../../../shared/ui/labels.js";

function removeButton(item) {
  if (item.status !== "yanked")
    return html`<button class="btn small ghost danger-text" data-action="yank" data-version="${item.version}">Retirar</button>`;
  return can.deletePackages()
    ? html`<button class="btn small ghost danger-text" data-action="hardDelete" data-version="${item.version}">${icon("trash", 16)}Eliminar</button>`
    : "";
}

function actionsCell(item) {
  return html`<td class="actions">
        ${item.status === "active" ? html`<button class="btn small ghost" data-action="deprecate" data-version="${item.version}">Deprecar</button>` : ""}
        ${removeButton(item)}
      </td>`;
}

function versionRow(item, manage) {
  return html`<tr>
      <td><b>${item.version}</b>${item.deprecatedMessage ? html`<div class="muted small">${item.deprecatedMessage}</div>` : ""}</td>
      <td>${statusBadge(item.status)}</td>
      <td class="hide-sm">${timeTag(item.publishedAt)}</td>
      ${manage ? actionsCell(item) : ""}
    </tr>`;
}

export function versionsPanel(versions) {
  const manage = can.managePackages(versions[0]?.name);
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Versión</th><th scope="col">Estado</th><th scope="col" class="hide-sm">Publicada</th>${manage ? html`<th scope="col"><span class="sr-only">Acciones</span></th>` : ""}</tr></thead>
    <tbody>${versions.map((item) => versionRow(item, manage))}</tbody></table></div>
    ${manage ? html`<p class="hint">Deprecar avisa a quien instale la versión. Retirar (yank) impide nuevas resoluciones. Solo una versión retirada puede eliminarse definitivamente.</p>` : ""}`;
}

export function versionActions(name, changed) {
  return {
    deprecate: (button) =>
      promptDialog({
        title: `Deprecar ${name}@${button.dataset.version}`,
        message: "La versión seguirá instalable, pero la CLI mostrará este aviso.",
        label: "Mensaje para quien la use",
        placeholder: "Usa la versión 2.x, que corrige…",
        confirmLabel: "Deprecar versión",
        action: (message) => post("/admin/packages/deprecate", { name, version: button.dataset.version, message }),
      }).then((value) => value !== null && changed("Versión deprecada")),
    yank: (button) =>
      promptDialog({
        title: `Retirar ${name}@${button.dataset.version}`,
        message:
          "Una versión retirada deja de resolverse para instalaciones nuevas. Los proyectos que ya la fijaron conservan su copia.",
        label: "Motivo",
        placeholder: "Vulnerabilidad, publicación errónea…",
        confirmLabel: "Retirar versión",
        danger: true,
        action: (reason) => post("/admin/packages/yank", { name, version: button.dataset.version, reason }),
      }).then((value) => value !== null && changed("Versión retirada")),
    hardDelete: (button) => {
      const spec = `${name}@${button.dataset.version}`;
      confirmDialog({
        title: "Eliminar definitivamente",
        message: "Se borrarán la versión, su artefacto y su conocimiento asociado. Esta acción no se puede deshacer.",
        typed: spec,
        confirmLabel: "Eliminar para siempre",
        action: () => del("/admin/packages", { name, version: button.dataset.version, confirmation: spec }),
      }).then((ok) => ok && changed("Versión eliminada"));
    },
  };
}
