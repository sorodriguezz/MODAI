import { get, post } from "../../shared/lib/api.js";
import { delegate, html } from "../../shared/lib/html.js";
import { codeBlock } from "../../shared/ui/code-block.js";
import { closeDialog, openDialog } from "../../shared/ui/dialog.js";
import { bindForm } from "../../shared/ui/form.js";
import { factorField } from "../../shared/ui/mfa-code.js";
import { passwordField } from "../../shared/ui/password.js";
import { toast, toastError } from "../../shared/ui/toast.js";

const path = "/auth/mfa";
const title = "Verificación en dos pasos";

function showRecovery(codes) {
  const body = openDialog({
    title: "Guarda tus códigos de recuperación",
    body: html`<div class="stack">
      <p>Cada código sirve una sola vez. Guárdalos en un lugar seguro para poder entrar si pierdes acceso a tu aplicación. Solo se muestran aquí.</p>
      ${codeBlock("mfaRecoveryCodes", codes.join("\n"), "Copiar códigos")}
      <div class="dialog-actions"><button type="button" class="btn primary" data-action="done">He guardado los códigos</button></div>
    </div>`,
  });
  delegate(body.firstElementChild, { done: closeDialog });
}

function bindMfaForm(form, action) {
  const back = form.querySelector("[data-mfa-back]");
  back.addEventListener("click", openAccountMfa);
  bindForm(form, async () => {
    back.disabled = true;
    try {
      await action();
    } finally {
      back.disabled = false;
    }
  });
}

function confirmSetup({ secret, setupToken }) {
  const body = openDialog({
    title: "Vincular aplicación autenticadora",
    description: "Crea una cuenta basada en tiempo en tu aplicación e introduce esta clave manualmente.",
    body: html`<form class="stack" novalidate>
      ${codeBlock("mfaSetupSecret", secret, "Copiar clave")}
      <p class="hint">Es un código TOTP de 6 dígitos que cambia cada 30 segundos.</p>
      ${factorField("mfaSetupCode", { recovery: false })}
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-mfa-back>Volver</button>
        <button type="submit" class="btn primary">Activar verificación</button>
      </div>
    </form>`,
  });
  const form = body.querySelector("form");
  bindMfaForm(form, async () => {
    const result = await post(`${path}/confirm`, { setupToken, code: form.code.value.trim() });
    if (form.isConnected) showRecovery(result.recoveryCodes);
  });
}

function authorizeAction({ label, operation, description, confirmFactor, danger = false }) {
  const body = openDialog({
    title: label,
    description,
    size: "sm",
    body: html`<form class="stack" novalidate>
      ${passwordField({ id: "mfaPassword", label: "Contraseña actual", autocomplete: "current-password" })}
      ${confirmFactor ? factorField("mfaChangeCode") : ""}
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions">
        <button type="button" class="btn ghost" data-mfa-back>Volver</button>
        <button type="submit" class="btn ${danger ? "danger" : "primary"}">${label}</button>
      </div>
    </form>`,
  });
  const form = body.querySelector("form");
  bindMfaForm(form, async () => {
    const input = { currentPassword: form.mfaPassword.value };
    if (confirmFactor) input.code = form.code.value.trim();
    const result = await post(`${path}/${operation}`, input);
    if (!form.isConnected) return;
    if (operation === "setup") return confirmSetup(result);
    if (operation === "recovery") return showRecovery(result.recoveryCodes);
    closeDialog();
    toast("Verificación en dos pasos desactivada.");
  });
}

export async function openAccountMfa() {
  try {
    const status = await get(path);
    const body = openDialog({
      title,
      size: "sm",
      body: html`<div class="stack">
        <p><b>${status.enabled ? "Activada" : "Desactivada"}</b></p>
        <p>${status.enabled ? `Códigos de recuperación disponibles: ${status.recoveryCodesRemaining}.` : "Protege el acceso a tu cuenta con un código de tu aplicación autenticadora."}</p>
        <div class="dialog-actions">${
          status.enabled
            ? html`
          <button type="button" class="btn ghost danger-text" data-action="disable">Desactivar verificación</button>
          <button type="button" class="btn primary" data-action="recovery">Generar nuevos códigos</button>`
            : html`
          <button type="button" class="btn primary" data-action="setup">Configurar verificación</button>`
        }</div>
      </div>`,
    });
    delegate(body.firstElementChild, {
      setup: () =>
        authorizeAction({
          label: "Continuar",
          operation: "setup",
          description: "Confirma tu contraseña para vincular una aplicación autenticadora.",
        }),
      recovery: () =>
        authorizeAction({
          label: "Generar nuevos códigos",
          operation: "recovery",
          description: "Los códigos de recuperación anteriores quedarán invalidados.",
          confirmFactor: true,
        }),
      disable: () =>
        authorizeAction({
          label: "Desactivar verificación",
          operation: "disable",
          description: "Al desactivar la verificación en dos pasos, podrás entrar con tu contraseña.",
          confirmFactor: true,
          danger: true,
        }),
    });
  } catch (error) {
    toastError(error);
  }
}
