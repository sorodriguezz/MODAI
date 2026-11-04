import { state } from "../../app/state.js";
import { post } from "../../shared/lib/api.js";
import { html } from "../../shared/lib/html.js";
import { closeDialog, openDialog } from "../../shared/ui/dialog.js";
import { bindForm } from "../../shared/ui/form.js";
import { bindStrength, passwordField, strengthMeter } from "../../shared/ui/password.js";
import { toast } from "../../shared/ui/toast.js";

export function openChangePassword() {
  const min = state.minPasswordLength;
  const body = openDialog({
    title: "Cambiar contraseña",
    description: "Al guardar se cerrarán tus sesiones en otros dispositivos.",
    size: "sm",
    body: html`<form class="stack" novalidate>
      <input type="text" name="username" autocomplete="username" value="${state.user?.username || ""}" hidden>
      ${passwordField({ id: "currentPassword", label: "Contraseña actual", autocomplete: "current-password" })}
      ${passwordField({ id: "newPassword", label: "Nueva contraseña", autocomplete: "new-password", minlength: min, hint: `Mínimo ${min} caracteres y distinta de la actual.` })}
      ${strengthMeter("newStrength")}
      ${passwordField({ id: "confirmPassword", label: "Repite la nueva contraseña", autocomplete: "new-password", minlength: min })}
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Guardar contraseña</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindStrength(form.newPassword, body.querySelector("#newStrength"));
  bindForm(form, async () => {
    if (form.newPassword.value !== form.confirmPassword.value) throw new Error("Las contraseñas nuevas no coinciden.");
    await post("/auth/password", { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value });
    closeDialog();
    toast("Contraseña actualizada. Las demás sesiones se cerraron.");
  });
}
