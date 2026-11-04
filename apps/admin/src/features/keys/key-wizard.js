import { can, state, store } from "../../app/state.js";
import { get } from "../../shared/lib/api.js";
import { html } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { reviewList, wizard } from "../../shared/lib/wizard.js";
import { codeBlock } from "../../shared/ui/code-block.js";
import { closeDialog, openDialog } from "../../shared/ui/dialog.js";
import { bindForm } from "../../shared/ui/form.js";
import { bindGrants, grantChoices } from "../admin/users/grants.js";
import { drawKeyRoles, keyFormBody, keyReview, saveKey } from "./key-wizard-steps.js";

const ROLES = ["reader", "publisher", "worker", "org-admin", "admin"];

function satisfies(role, minimum) {
  return (
    role === "admin" || minimum === "reader" || role === minimum || (role === "org-admin" && minimum === "publisher")
  );
}

export function keyRoles(ownerRole) {
  return ROLES.filter((role) => satisfies(ownerRole, role) || (role === "worker" && satisfies(ownerRole, "publisher")));
}

export function showNewKey(key, extra) {
  const body = openDialog({
    title: `API key creada: ${key.label}`,
    size: "md",
    body: html`<div class="callout tone-warning">${icon("alert")}<span>El token se muestra una sola vez. Guárdalo o entrégalo por un canal privado antes de cerrar.</span></div>
      ${codeBlock("newKeyToken", key.token, "Copiar token")}
      ${extra || html`<p class="hint">En el equipo: <code>modai server connect ${location.origin}</code> y pega el token cuando lo pida.</p>`}
      <div class="dialog-actions"><button type="button" class="btn primary" data-close>He guardado el token</button></div>`,
  });
  body.querySelector("[data-close]").addEventListener("click", closeDialog);
}

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

function currentUser() {
  return {
    id: state.user?.id,
    username: state.user?.username,
    role: state.identity?.role,
    displayName: state.user?.displayName,
  };
}

async function loadOwners(mode, me) {
  if (mode !== "admin") return [me];
  const { users } = await get("/admin/users");
  return [me, ...users.filter((u) => u.id !== me.id && !u.disabledAt)];
}

async function loadChoices(mode) {
  const choices = await grantChoices().catch(() => ({ organizations: [], projects: [], namespaces: [] }));
  if (mode === "self") {
    choices.organizations = await store.organizations().catch(() => []);
    choices.namespaces = choices.namespaces.filter(
      (n) => can.admin() || n.canPublish || (state.identity?.packageScopes || []).includes(n.name),
    );
  }
  return choices;
}

function wizardTitle(mode, key) {
  if (key) return `Accesos de ${key.label}`;
  return mode === "self" ? "Nueva API key" : "Nueva API key para un usuario";
}

export async function openKeyWizard({ mode, key, owner, onSaved }) {
  const me = currentUser();
  const owners = await loadOwners(mode, me);
  const choices = await loadChoices(mode);
  let currentOwner = owners.find((o) => o.id === (key?.ownerId || owner?.id)) || me;
  const body = openDialog({
    title: wizardTitle(mode, key),
    description:
      "Una API key conecta la CLI, tu editor (MCP) o un worker en nombre de una persona. Nunca tiene más permisos que esa persona: si a su cuenta le quitan accesos o la desactivan, la key también los pierde.",
    size: "lg",
    body: keyFormBody({ mode, key, owners, currentOwner, choices }),
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  drawKeyRoles(form, keyRoles(currentOwner.role));
  form.querySelector("#keyOwner")?.addEventListener("change", (event) => {
    currentOwner = owners.find((o) => o.id === event.target.value) || me;
    drawKeyRoles(form, keyRoles(currentOwner.role));
  });
  bindGrants(form);
  const inherit = () => form.querySelector('input[name="keyScope"]:checked').value === "inherit";
  wizard(form, {
    skip: { organizations: inherit, projects: inherit, namespaces: inherit },
    validate: { keyRole: () => (form.querySelector('input[name="keyRoleValue"]:checked') ? "" : "Elige un rol.") },
    onEnter: {
      review: () => {
        form.querySelector("[data-review]").innerHTML = reviewList(
          keyReview(form, { key, currentOwner, choices, inherit: inherit() }),
        );
      },
    },
  });
  bindForm(form, async () => {
    const created = await saveKey(form, { mode, key, currentOwner, inherit: inherit() });
    if (created) showNewKey(created);
    await onSaved?.();
  });
}
