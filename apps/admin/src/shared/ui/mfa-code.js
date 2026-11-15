import { html } from "../lib/html.js";

export function factorField(id, { recovery = true, hidden = false } = {}) {
  return html`<div class="field" ${hidden ? "hidden" : ""}>
    <label for="${id}">${recovery ? "Código de verificación o recuperación" : "Código de la aplicación"}</label>
    <input id="${id}" name="code" type="text" maxlength="${recovery ? 80 : 6}" autocomplete="one-time-code" autocapitalize="off" spellcheck="false"
      ${recovery ? "" : html`inputmode="numeric" pattern="[0-9]{6}"`} ${hidden ? "disabled" : "required"}>
  </div>`;
}
