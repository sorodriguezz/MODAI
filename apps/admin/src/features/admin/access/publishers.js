import { patch, post } from "../../../shared/lib/api.js";
import { html } from "../../../shared/lib/html.js";
import { closeDialog, openDialog } from "../../../shared/ui/dialog.js";
import { emptyState } from "../../../shared/ui/empty-state.js";
import { bindForm } from "../../../shared/ui/form.js";
import { timeTag } from "../../../shared/ui/format.js";
import { toast, toastError } from "../../../shared/ui/toast.js";

export function publisherForm(onSaved) {
  const body = openDialog({
    title: "Registrar publicador",
    description: "Las claves públicas Ed25519 permiten verificar la firma de los paquetes.",
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="pubLabel">Nombre</label><input id="pubLabel" required maxlength="200" placeholder="Equipo de plataforma"></div>
      <div class="field"><label for="pubKey">Clave pública (PEM)</label><textarea id="pubKey" class="mono" rows="6" required maxlength="4096" placeholder="-----BEGIN PUBLIC KEY-----"></textarea></div>
      <label class="checkbox"><input type="checkbox" id="pubTrusted" checked> Marcar como de confianza</label>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Registrar</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    await post("/admin/publishers", {
      label: form.pubLabel.value.trim(),
      publicKey: form.pubKey.value.trim(),
      trusted: form.pubTrusted.checked,
    });
    closeDialog();
    toast("Publicador registrado");
    await onSaved();
  });
}

function publisherRow(p) {
  return html`<tr>
            <td><b>${p.label || "Sin nombre"}</b></td>
            <td><code title="${p.fingerprint}">${p.fingerprint.slice(0, 20)}…</code></td>
            <td><label class="switch"><input type="checkbox" role="switch" data-action="trust" data-fingerprint="${p.fingerprint}" ${p.trusted ? "checked" : ""} aria-label="De confianza: ${p.label || p.fingerprint}"><span class="switch-track" aria-hidden="true"></span><span>${p.trusted ? "De confianza" : "No confiable"}</span></label></td>
            <td class="hide-sm">${timeTag(p.createdAt)}</td></tr>`;
}

export function publishersTable(publishers) {
  return publishers.length
    ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Publicador</th><th scope="col">Huella</th><th scope="col">Confianza</th><th scope="col" class="hide-sm">Registrado</th></tr></thead>
          <tbody>${publishers.map(publisherRow)}</tbody></table></div>`
    : emptyState({
        iconName: "shield",
        title: "Sin publicadores registrados",
        text: "Con la política de firmas «trusted» solo se aceptan paquetes firmados por publicadores de confianza.",
      });
}

export function bindTrustToggles(root, onChanged) {
  root.addEventListener("change", async (event) => {
    const input = event.target.closest('[data-action="trust"]');
    if (!input) return;
    input.disabled = true;
    try {
      await patch(`/admin/publishers/${encodeURIComponent(input.dataset.fingerprint)}`, { trusted: input.checked });
      toast(input.checked ? "Publicador marcado como de confianza" : "Confianza retirada");
      await onChanged();
    } catch (error) {
      input.checked = !input.checked;
      input.disabled = false;
      toastError(error);
    }
  });
}
