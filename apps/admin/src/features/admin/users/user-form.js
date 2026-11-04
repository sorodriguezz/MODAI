import { can, state } from "../../../app/state.js";
import { patch, post } from "../../../shared/lib/api.js";
import { delegate, html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { reviewList, wizard } from "../../../shared/lib/wizard.js";
import { codeBlock } from "../../../shared/ui/code-block.js";
import { closeDialog, openDialog } from "../../../shared/ui/dialog.js";
import { bindForm } from "../../../shared/ui/form.js";
import { bindStrength, generatePassword, passwordField, strengthMeter } from "../../../shared/ui/password.js";
import { toast } from "../../../shared/ui/toast.js";
import { bindGrants, grantSteps, grantsFields, readGrants } from "./grants.js";

const userPath = (user) => `/admin/users/${encodeURIComponent(user.id)}`;

function passwordBlock(min) {
  return html`
        <div class="field">
          ${passwordField({ id: "userPassword", label: "Contraseña inicial", autocomplete: "new-password", minlength: min, hint: `Mínimo ${min} caracteres. Compártela por un canal privado; la persona puede cambiarla desde su menú.` })}
          ${strengthMeter("userStrength")}
          <button type="button" class="btn small ghost" data-action="generate">${icon("spark", 16)}Generar contraseña segura</button>
        </div>`;
}

function accountStep(user, editing) {
  return html`<section data-step="account" data-title="Cuenta"><div class="stack">
      <div class="field-row">
        <div class="field"><label for="userUsername">Usuario</label><input id="userUsername" required minlength="3" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${user?.username || ""}" ${editing ? "disabled" : ""}>${editing ? "" : html`<p class="hint">3–64 caracteres: letras, números, punto, guion o guion bajo.</p>`}</div>
        <div class="field"><label for="userDisplay">Nombre visible</label><input id="userDisplay" maxlength="200" value="${user?.displayName || ""}" placeholder="María Pérez"></div>
      </div>
      ${editing ? "" : passwordBlock(state.minPasswordLength)}
      </div></section>`;
}

function userFormBody(user, choices, self) {
  const editing = Boolean(user);
  const grants = grantsFields({
    role: user?.role || "reader",
    projectIds: user?.projectIds,
    organizationIds: user?.organizationIds,
    packageScopes: user?.packageScopes,
    ...choices,
    roleLocked: self || (user?.role === "admin" && !can.admin()),
  });
  return html`<form class="stack wizard" novalidate>
      ${accountStep(user, editing)}
      ${grants}
      <section data-step="review" data-title="Revisión"><p class="hint">Revisa antes de ${editing ? "guardar" : "crear la cuenta"}. Puedes volver a cualquier paso desde la barra superior.</p><div data-review></div></section>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar cambios" : "Crear usuario"}</button></div>
    </form>`;
}

async function saveUser(form, user, self) {
  const grants = readGrants(form);
  const displayName = form.userDisplay.value.trim();
  const access = {
    projectIds: grants.projectIds,
    organizationIds: grants.organizationIds,
    packageScopes: grants.packageScopes,
  };
  if (user) {
    const payload = { ...access };
    if (!self) payload.role = grants.role;
    if (displayName) payload.displayName = displayName;
    await patch(userPath(user), payload);
    toast("Usuario actualizado");
    closeDialog();
    return;
  }
  const password = form.userPassword.value;
  const { user: created } = await post("/admin/users", {
    username: form.userUsername.value.trim(),
    displayName: displayName || undefined,
    password,
    role: grants.role,
    ...access,
  });
  showCredentials(created.username, password, "Usuario creado");
}

export function userForm(user, choices, onSaved) {
  const editing = Boolean(user);
  const self = editing && user.id === state.user?.id;
  const body = openDialog({
    title: editing ? `Editar ${user.username}` : "Nuevo usuario",
    description: editing
      ? "Los cambios de rol y permisos se aplican de inmediato, también a las sesiones abiertas."
      : "La persona podrá entrar al panel con este usuario y contraseña.",
    size: "lg",
    body: userFormBody(user, choices, self),
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  if (!editing) bindStrength(form.userPassword, body.querySelector("#userStrength"));
  bindGrants(form);
  const steps = grantSteps(choices);
  const username = () => (editing ? user.username : form.userUsername.value.trim());
  wizard(form, {
    start: editing ? 1 : 0,
    validate: steps.validate,
    onEnter: {
      review: () => {
        form.querySelector("[data-review]").innerHTML = reviewList([
          ["Usuario", username()],
          ["Nombre visible", form.userDisplay.value.trim() || (editing ? user.displayName : username())],
          ...steps.review(form),
        ]);
      },
    },
  });
  delegate(body, {
    generate: () => {
      form.userPassword.value = generatePassword();
      form.userPassword.type = "text";
      form.userPassword.dispatchEvent(new Event("input"));
      form.userPassword.select();
    },
  });
  bindForm(form, async () => {
    await saveUser(form, user, self);
    await onSaved();
  });
}

function showCredentials(username, password, title) {
  const body = openDialog({
    title,
    size: "sm",
    body: html`<div class="callout tone-warning">${icon("alert")}<span>Es la única vez que verás esta contraseña. Entrégala por un canal privado.</span></div>
      <dl class="definition-grid single"><div><dt>Panel</dt><dd>${location.origin}/admin</dd></div><div><dt>Usuario</dt><dd><code>${username}</code></dd></div></dl>
      ${codeBlock("newPasswordValue", password, "Copiar contraseña")}
      <div class="dialog-actions"><button type="button" class="btn primary" data-close>Listo</button></div>`,
  });
  body.querySelector("[data-close]").addEventListener("click", closeDialog);
}

export function resetPassword(user, onSaved) {
  const min = state.minPasswordLength;
  const body = openDialog({
    title: "Restablecer contraseña",
    description: `${user.username} deberá usar la nueva contraseña. Sus sesiones abiertas se cerrarán.`,
    size: "sm",
    body: html`<form class="stack" novalidate>
      ${passwordField({ id: "resetPassword", label: "Nueva contraseña", autocomplete: "new-password", minlength: min, value: generatePassword() })}
      ${strengthMeter("resetStrength")}
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Restablecer</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindStrength(form.resetPassword, body.querySelector("#resetStrength"));
  bindForm(form, async () => {
    const password = form.resetPassword.value;
    await patch(userPath(user), { password });
    showCredentials(user.username, password, "Contraseña restablecida");
    await onSaved();
  });
}
