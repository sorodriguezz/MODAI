import { del, get, put } from "../../shared/lib/api.js";
import { delegate, html, mount } from "../../shared/lib/html.js";
import { confirmDialog } from "../../shared/ui/dialog.js";
import { errorState } from "../../shared/ui/empty-state.js";
import { bindForm } from "../../shared/ui/form.js";
import { timeTag } from "../../shared/ui/format.js";
import { toast } from "../../shared/ui/toast.js";

export const scopeNames = { project: "Proyecto", organization: "Organización", team: "Equipo" };
const collections = { project: "projects", organization: "organizations", team: "teams" };

function existingBindings(bindings) {
  if (!bindings.length) return html`<p class="muted">Este ámbito no tiene asignaciones.</p>`;
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th>Identificador</th><th>Paquete</th><th>Política</th><th><span class="sr-only">Acciones</span></th></tr></thead>
    <tbody>${bindings.map(
      (item) => html`<tr><td><code>${item.slot}</code></td><td>${item.packageName}@${item.range}</td>
      <td>${item.required ? "Obligatoria" : "Opcional"}${item.exception ? html`<br>Revisión ${timeTag(item.exception.reviewAt)} · ${item.exception.reason}` : ""}</td>
      <td class="actions"><button type="button" class="btn small" data-action="edit-binding" data-slot="${item.slot}">Editar</button>
      <button type="button" class="btn small ghost danger-text" data-action="delete-binding" data-slot="${item.slot}">Quitar</button></td></tr>`,
    )}</tbody>
  </table></div>`;
}

function localInputDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

function bindingForm(item) {
  return html`<form class="stack" novalidate>
    <h3>${item ? "Editar asignación" : "Nueva asignación"}</h3>
    <div class="field-row">
      <div class="field"><label for="profileSlot">Identificador de la capacidad</label><input id="profileSlot" name="slot" value="${item?.slot || ""}" placeholder="Usa el nombre del paquete si se deja vacío" maxlength="214" ${item ? "readonly" : ""}></div>
      <div class="field"><label for="profilePackage">Paquete</label><input id="profilePackage" name="packageName" value="${item?.packageName || ""}" placeholder="@namespace/paquete" maxlength="214" required></div>
      <div class="field"><label for="profileRange">Versión o rango SemVer</label><input id="profileRange" name="range" value="${item?.range || ""}" placeholder="^1.0.0" maxlength="100" required></div>
    </div>
    <label><input type="checkbox" name="required" ${item?.required ? "checked" : ""}> Asignación obligatoria</label>
    <details ${item?.exception ? "open" : ""}><summary>Justificación y fecha de revisión de una excepción</summary>
      <div class="field"><label for="profileReason">Justificación</label><textarea id="profileReason" name="reason" maxlength="2000" rows="2">${item?.exception?.reason || ""}</textarea></div>
      <div class="field"><label for="profileReview">Fecha de revisión</label><input id="profileReview" name="reviewAt" type="datetime-local" step="1" value="${localInputDate(item?.exception?.reviewAt)}"></div>
    </details>
    <div class="form-error" role="alert" hidden></div>
    <div class="dialog-actions">${item ? html`<button type="button" class="btn ghost" data-action="new-binding">Cancelar edición</button>` : ""}<button class="btn primary" type="submit">Guardar asignación</button></div>
  </form>`;
}

function bindingInput(form) {
  const data = new FormData(form);
  const slot = data.get("slot").trim();
  const reason = data.get("reason").trim();
  const reviewAt = data.get("reviewAt");
  if (Boolean(reason) !== Boolean(reviewAt)) throw new Error("Completa la justificación y la fecha de revisión.");
  return {
    ...(slot && { slot }),
    packageName: data.get("packageName").trim(),
    range: data.get("range").trim(),
    required: data.has("required"),
    ...(reason && { exception: { reason, reviewAt: new Date(reviewAt).toISOString() } }),
  };
}

export async function renderBindings(root, project, reopen) {
  const organization = project.organizationId;
  const teams = organization ? (await get(`/organizations/${encodeURIComponent(organization)}/teams`)).teams : [];
  const scopes = [
    { id: project.id, label: project.name, type: "project" },
    ...(organization
      ? [{ id: organization, label: project.organizationName || organization, type: "organization" }]
      : []),
    ...teams.map((team) => ({ id: team.id, label: team.name, type: "team" })),
  ];
  mount(
    root,
    html`<div class="stack">
    <div class="field"><label for="profileScope">Ámbito de asignación</label><select id="profileScope">${scopes.map((scope, index) => html`<option value="${index}">${scopeNames[scope.type]} · ${scope.label}</option>`)}</select></div>
    <div data-bindings></div><div data-binding-editor></div>
  </div>`,
  );
  const scope = root.querySelector("select");
  const list = root.querySelector("[data-bindings]");
  const editor = root.querySelector("[data-binding-editor]");
  let bindings = [];
  let revision = 0;
  const url = () => {
    const selected = scopes[Number(scope.value)];
    return `/${collections[selected.type]}/${encodeURIComponent(selected.id)}/bindings`;
  };
  const showEditor = (item) => {
    const path = url();
    const form = mount(editor, bindingForm(item)).querySelector("form");
    bindForm(form, async () => {
      await put(path, bindingInput(form));
      toast("Asignación guardada");
      if (form.isConnected) await refresh();
    });
  };
  const refresh = async () => {
    const current = ++revision;
    mount(list, html`<p class="muted" role="status">Cargando asignaciones…</p>`);
    mount(editor, "");
    try {
      const result = await get(url());
      if (current !== revision) return;
      bindings = result.bindings;
      mount(list, existingBindings(bindings));
      showEditor();
    } catch (error) {
      if (current === revision) mount(list, errorState(error));
    }
  };
  scope.addEventListener("change", refresh);
  delegate(root, {
    "edit-binding": (button) => {
      showEditor(bindings.find(({ slot }) => slot === button.dataset.slot));
      editor.querySelector("#profilePackage")?.focus();
    },
    "new-binding": () => showEditor(),
    "delete-binding": async (button) => {
      const path = `${url()}/${encodeURIComponent(button.dataset.slot)}`;
      const removed = await confirmDialog({
        title: "Quitar asignación",
        message: html`Quitarás <b>${button.dataset.slot}</b> de este ámbito.`,
        confirmLabel: "Quitar asignación",
        action: () => del(path),
      });
      if (removed) toast("Asignación retirada");
      reopen();
    },
  });
  await refresh();
}
