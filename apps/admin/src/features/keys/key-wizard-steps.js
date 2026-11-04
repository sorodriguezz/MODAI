import { patch, post } from "../../shared/lib/api.js";
import { html } from "../../shared/lib/html.js";
import { closeDialog } from "../../shared/ui/dialog.js";
import { roleDescriptions, roleLabels } from "../../shared/ui/labels.js";
import { toast } from "../../shared/ui/toast.js";
import { grantsFields, readGrants } from "../admin/users/grants.js";

const ownerHint = (editing, key) =>
  editing && !key.ownerId
    ? "Esta key se creó antes de que las keys tuvieran dueño. Asígnale uno: desde entonces quedará limitada a sus permisos."
    : "La key actuará en su nombre y con, como máximo, sus permisos. Para un worker o CI, crea un usuario para ese fin (por ejemplo ci-bot).";

function ownerStep({ owners, currentOwner, key, editing }) {
  return html`<section data-step="owner" data-title="Dueño"><div class="field"><label for="keyOwner">¿De quién es la API key?</label>
        <select id="keyOwner" required>${owners.map((o) => html`<option value="${o.id}" ${o.id === currentOwner.id ? "selected" : ""}>${o.displayName || o.username} (@${o.username}) · ${roleLabels[o.role]}</option>`)}</select>
        <p class="hint">${ownerHint(editing, key)}</p></div></section>`;
}

function newKeySteps() {
  return html`<section data-step="label" data-title="Nombre"><div class="field"><label for="keyLabel">¿Dónde se usará?</label><input id="keyLabel" required maxlength="200" placeholder="Notebook personal · worker CI · Claude Code"><p class="hint">Una key por equipo o programa: así puedes revocar una sin afectar a las demás.</p></div></section>
      <section data-step="keyRole" data-title="Rol"><fieldset class="field"><legend>¿Qué podrá hacer?</legend><div class="role-options" id="keyRoles"></div><p class="hint">Solo puedes elegir el rol de la cuenta dueña o uno menor.</p></fieldset></section>`;
}

function scopeStep(key) {
  const inherit = !key || key.inherit;
  return html`<section data-step="scope" data-title="Accesos"><fieldset class="field"><legend>¿A qué tendrá acceso?</legend><div class="role-options">
        <label class="role-option"><input type="radio" name="keyScope" value="inherit" ${inherit ? "checked" : ""}><span><b>Lo mismo que la cuenta</b><span class="muted small">Sigue los cambios de la cuenta: si gana o pierde accesos, la key también. Lo más simple.</span></span></label>
        <label class="role-option"><input type="radio" name="keyScope" value="narrow" ${inherit ? "" : "checked"}><span><b>Solo una parte</b><span class="muted small">Elige organizaciones, proyectos y namespaces dentro de los de la cuenta. Recomendado para CI y workers.</span></span></label>
      </div></fieldset></section>`;
}

export function keyFormBody({ mode, key, owners, currentOwner, choices }) {
  const editing = Boolean(key);
  return html`<form class="stack wizard" novalidate>
      ${mode === "admin" ? ownerStep({ owners, currentOwner, key, editing }) : ""}
      ${editing ? "" : newKeySteps()}
      ${scopeStep(key)}
      ${grantsFields({ projectIds: key?.projectIds, organizationIds: key?.organizationIds, packageScopes: key?.packageScopes, ...choices, withRole: false })}
      <section data-step="review" data-title="Revisión"><div data-review></div></section>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar" : "Crear API key"}</button></div>
    </form>`;
}

function pickRole(options, selected) {
  if (options.includes(selected)) return selected;
  return options.includes("publisher") ? "publisher" : options[0];
}

export function drawKeyRoles(form, options) {
  const box = form.querySelector("#keyRoles");
  if (!box) return;
  const pick = pickRole(options, form.querySelector('input[name="keyRoleValue"]:checked')?.value);
  box.innerHTML = options
    .map(
      (role) =>
        `<label class="role-option"><input type="radio" name="keyRoleValue" value="${role}" ${role === pick ? "checked" : ""}><span><b>${roleLabels[role]}</b><span class="muted small">${roleDescriptions[role]}</span></span></label>`,
    )
    .join("");
}

export function keyReview(form, { key, currentOwner, choices, inherit }) {
  const grants = readGrants(form);
  const names = (ids, list) => ids.map((id) => list.find((item) => item.id === id)?.name || id);
  const role = key ? key.role : form.querySelector('input[name="keyRoleValue"]:checked')?.value;
  const access = inherit
    ? [["Accesos", "Los mismos que la cuenta"]]
    : [
        ["Organizaciones", names(grants.organizationIds, choices.organizations)],
        ["Proyectos", names(grants.projectIds, choices.projects)],
        ["Namespaces", grants.packageScopes],
      ];
  return [
    ["Dueño", `${currentOwner.displayName || currentOwner.username} (@${currentOwner.username})`],
    ["API key", key ? key.label : form.keyLabel.value.trim()],
    ["Rol", roleLabels[role]],
    ...access,
  ];
}

export async function saveKey(form, { mode, key, currentOwner, inherit }) {
  const grants = readGrants(form);
  const access = inherit
    ? { inherit: true }
    : {
        inherit: false,
        projectIds: grants.projectIds,
        organizationIds: grants.organizationIds,
        packageScopes: grants.packageScopes,
      };
  if (key) {
    await patch(`/admin/api-keys/${encodeURIComponent(key.id)}`, {
      ...access,
      ...(mode === "admin" ? { ownerId: currentOwner.id } : {}),
    });
    closeDialog();
    toast("Accesos actualizados");
    return null;
  }
  const payload = {
    label: form.keyLabel.value.trim(),
    role: form.querySelector('input[name="keyRoleValue"]:checked').value,
    ...access,
  };
  const { key: created } =
    mode === "self"
      ? await post("/me/api-keys", payload)
      : await post("/admin/api-keys", { ...payload, ownerId: currentOwner.id });
  return created;
}
