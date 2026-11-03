// One flow for every API key: a key always belongs to a user and never exceeds that user's permissions.
// People create their own keys ("Mis API keys", "Conectar un cliente"); administrators can also create or adjust
// keys for the users they manage. The server enforces the same limits.

import { get, patch, post } from "../lib/api.js";
import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { bindForm, closeDialog, codeBlock, openDialog, roleDescriptions, roleLabels, toast } from "../lib/ui.js";
import { reviewList, wizard } from "../lib/wizard.js";
import { can, state, store } from "../state.js";
import { bindGrants, grantChoices, grantsFields, readGrants } from "./users.js";

const ROLES = ["reader", "publisher", "worker", "org-admin", "admin"];
/** Mirrors keyRoleAllowed on the server: the owner's role or a narrower one; worker fits any account that publishes. */
export function keyRoles(ownerRole) {
  const satisfies = (role, minimum) =>
    role === "admin" || minimum === "reader" || role === minimum || (role === "org-admin" && minimum === "publisher");
  return ROLES.filter((role) => satisfies(ownerRole, role) || (role === "worker" && satisfies(ownerRole, "publisher")));
}

export function showNewKey(key, extra) {
  const body = openDialog({
    title: "API key creada: " + key.label,
    size: "md",
    body: html`<div class="callout tone-warning">${icon("alert")}<span>El token se muestra una sola vez. Guárdalo o entrégalo por un canal privado antes de cerrar.</span></div>
      ${codeBlock("newKeyToken", key.token, "Copiar token")}
      ${extra || html`<p class="hint">En el equipo: <code>modai server connect ${location.origin}</code> y pega el token cuando lo pida.</p>`}
      <div class="dialog-actions"><button type="button" class="btn primary" data-close>He guardado el token</button></div>`,
  });
  body.querySelector("[data-close]").addEventListener("click", closeDialog);
}

/** Summary of a key's access for tables. */
export function keyAccess(key) {
  if (!key.ownerId)
    return html`<span class="badge tone-warning" title="Creada antes de que las keys tuvieran dueño">Sin dueño</span>`;
  if (key.inherit) return html`<span class="muted">Igual que ${key.ownerName}</span>`;
  const parts = [
    key.projectIds.length && `${key.projectIds.length} proyecto(s)`,
    key.organizationIds.length && `${key.organizationIds.length} org.`,
    key.packageScopes.length && key.packageScopes.join(", "),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : html`<span class="muted">Solo lectura general</span>`;
}

/**
 * @param {{ mode: "self" | "admin", key?: object, owner?: { id: string, username: string, role: string }, onSaved: () => Promise<void> }} options
 */
export async function openKeyWizard({ mode, key, owner, onSaved }) {
  const editing = Boolean(key);
  const me = {
    id: state.user?.id,
    username: state.user?.username,
    role: state.identity?.role,
    displayName: state.user?.displayName,
  };
  // Owners an administrator can pick: itself and the users it manages.
  const owners =
    mode === "admin" ? [me, ...(await get("/admin/users")).users.filter((u) => u.id !== me.id && !u.disabledAt)] : [me];
  const choices = await grantChoices().catch(() => ({ organizations: [], projects: [], namespaces: [] }));
  if (mode === "self") {
    // Your own keys can only use what your account has.
    choices.organizations = await store.organizations().catch(() => []);
    choices.namespaces = choices.namespaces.filter(
      (n) => can.admin() || n.canPublish || (state.identity?.packageScopes || []).includes(n.name),
    );
  }
  let currentOwner = owners.find((o) => o.id === (key?.ownerId || owner?.id)) || me;
  const roleOptions = () => keyRoles(currentOwner.role);
  const body = openDialog({
    title: editing ? "Accesos de " + key.label : mode === "self" ? "Nueva API key" : "Nueva API key para un usuario",
    description:
      "Una API key conecta la CLI, tu editor (MCP) o un worker en nombre de una persona. Nunca tiene más permisos que esa persona: si a su cuenta le quitan accesos o la desactivan, la key también los pierde.",
    size: "lg",
    body: html`<form class="stack wizard" novalidate>
      ${
        mode === "admin"
          ? html`<section data-step="owner" data-title="Dueño"><div class="field"><label for="keyOwner">¿De quién es la API key?</label>
        <select id="keyOwner" required>${owners.map((o) => html`<option value="${o.id}" ${o.id === currentOwner.id ? "selected" : ""}>${o.displayName || o.username} (@${o.username}) · ${roleLabels[o.role]}</option>`)}</select>
        <p class="hint">${editing && !key.ownerId ? "Esta key se creó antes de que las keys tuvieran dueño. Asígnale uno: desde entonces quedará limitada a sus permisos." : "La key actuará en su nombre y con, como máximo, sus permisos. Para un worker o CI, crea un usuario para ese fin (por ejemplo ci-bot)."}</p></div></section>`
          : ""
      }
      ${editing ? "" : html`<section data-step="label" data-title="Nombre"><div class="field"><label for="keyLabel">¿Dónde se usará?</label><input id="keyLabel" required maxlength="200" placeholder="Notebook personal · worker CI · Claude Code"><p class="hint">Una key por equipo o programa: así puedes revocar una sin afectar a las demás.</p></div></section>`}
      ${editing ? "" : html`<section data-step="keyRole" data-title="Rol"><fieldset class="field"><legend>¿Qué podrá hacer?</legend><div class="role-options" id="keyRoles"></div><p class="hint">Solo puedes elegir el rol de la cuenta dueña o uno menor.</p></fieldset></section>`}
      <section data-step="scope" data-title="Accesos"><fieldset class="field"><legend>¿A qué tendrá acceso?</legend><div class="role-options">
        <label class="role-option"><input type="radio" name="keyScope" value="inherit" ${!key || key.inherit ? "checked" : ""}><span><b>Lo mismo que la cuenta</b><span class="muted small">Sigue los cambios de la cuenta: si gana o pierde accesos, la key también. Lo más simple.</span></span></label>
        <label class="role-option"><input type="radio" name="keyScope" value="narrow" ${key && !key.inherit ? "checked" : ""}><span><b>Solo una parte</b><span class="muted small">Elige organizaciones, proyectos y namespaces dentro de los de la cuenta. Recomendado para CI y workers.</span></span></label>
      </div></fieldset></section>
      ${grantsFields({ projectIds: key?.projectIds, organizationIds: key?.organizationIds, packageScopes: key?.packageScopes, ...choices, withRole: false })}
      <section data-step="review" data-title="Revisión"><div data-review></div></section>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar" : "Crear API key"}</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  const drawRoles = () => {
    const box = form.querySelector("#keyRoles");
    if (!box) return;
    const selected = form.querySelector('input[name="keyRoleValue"]:checked')?.value;
    const options = roleOptions();
    const pick = options.includes(selected) ? selected : options.includes("publisher") ? "publisher" : options[0];
    box.innerHTML = options
      .map(
        (role) =>
          `<label class="role-option"><input type="radio" name="keyRoleValue" value="${role}" ${role === pick ? "checked" : ""}><span><b>${roleLabels[role]}</b><span class="muted small">${roleDescriptions[role]}</span></span></label>`,
      )
      .join("");
  };
  drawRoles();
  form.querySelector("#keyOwner")?.addEventListener("change", (event) => {
    currentOwner = owners.find((o) => o.id === event.target.value) || me;
    drawRoles();
  });
  bindGrants(form);
  const inherit = () => form.querySelector('input[name="keyScope"]:checked').value === "inherit";
  const grantStep = () => inherit();
  wizard(form, {
    skip: { organizations: grantStep, projects: grantStep, namespaces: grantStep },
    validate: { keyRole: () => (form.querySelector('input[name="keyRoleValue"]:checked') ? "" : "Elige un rol.") },
    onEnter: {
      review: () => {
        const grants = readGrants(form);
        const names = (ids, list, k, label) => ids.map((id) => list.find((item) => item[k] === id)?.[label] || id);
        form.querySelector("[data-review]").innerHTML = reviewList([
          ["Dueño", `${currentOwner.displayName || currentOwner.username} (@${currentOwner.username})`],
          ["API key", editing ? key.label : form.keyLabel.value.trim()],
          ["Rol", roleLabels[editing ? key.role : form.querySelector('input[name="keyRoleValue"]:checked')?.value]],
          ...(inherit()
            ? [["Accesos", "Los mismos que la cuenta"]]
            : [
                ["Organizaciones", names(grants.organizationIds, choices.organizations, "id", "name")],
                ["Proyectos", names(grants.projectIds, choices.projects, "id", "name")],
                ["Namespaces", grants.packageScopes],
              ]),
        ]);
      },
    },
  });
  bindForm(form, async () => {
    const grants = readGrants(form);
    const access = inherit()
      ? { inherit: true }
      : {
          inherit: false,
          projectIds: grants.projectIds,
          organizationIds: grants.organizationIds,
          packageScopes: grants.packageScopes,
        };
    if (editing) {
      await patch("/admin/api-keys/" + encodeURIComponent(key.id), {
        ...access,
        ...(mode === "admin" ? { ownerId: currentOwner.id } : {}),
      });
      closeDialog();
      toast("Accesos actualizados");
    } else {
      const payload = {
        label: form.keyLabel.value.trim(),
        role: form.querySelector('input[name="keyRoleValue"]:checked').value,
        ...access,
      };
      const { key: created } =
        mode === "self"
          ? await post("/me/api-keys", payload)
          : await post("/admin/api-keys", { ...payload, ownerId: currentOwner.id });
      showNewKey(created);
    }
    await onSaved?.();
  });
}
