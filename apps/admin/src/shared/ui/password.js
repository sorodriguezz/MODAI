import { esc, html, raw } from "../lib/html.js";
import { icon, iconMarkup } from "../lib/icons.js";

const STRENGTH_LABELS = ["Muy corta", "Aceptable", "Buena", "Excelente"];

export function passwordField({
  id,
  label,
  autocomplete = "current-password",
  hint,
  minlength,
  value = "",
  required = true,
}) {
  const min = minlength ? raw(`minlength="${Number(minlength)}"`) : "";
  const described = hint ? raw(`aria-describedby="${esc(id)}Hint"`) : "";
  return html`<div class="field">
    <label for="${id}">${label}</label>
    <div class="input-group">
      <input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" ${min} value="${value}" ${required ? "required" : ""} ${described} spellcheck="false" autocapitalize="off">
      <button type="button" class="input-addon" data-toggle-password="${id}" aria-label="Mostrar contraseña" aria-pressed="false">${icon("eye")}</button>
    </div>
    ${hint ? html`<p class="hint" id="${id}Hint">${hint}</p>` : ""}
  </div>`;
}

export function initPasswordToggles() {
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle-password]");
    if (!toggle) return;
    const input = document.getElementById(toggle.dataset.togglePassword);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    toggle.innerHTML = iconMarkup(show ? "eyeOff" : "eye");
  });
}

export function passwordStrength(password) {
  const checks = [
    password.length >= 10,
    password.length >= 14,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const score = checks.filter(Boolean).length;
  const level = password.length < 10 ? 0 : Math.min(3, Math.max(1, score - 1));
  return { level, label: STRENGTH_LABELS[level] };
}

export function bindStrength(input, meter) {
  const update = () => {
    const { level, label } = passwordStrength(input.value);
    meter.dataset.level = String(input.value ? level : -1);
    meter.querySelector(".strength-label").textContent = input.value ? label : "";
  };
  input.addEventListener("input", update);
  update();
}

export const strengthMeter = (id) =>
  html`<div class="strength" id="${id}" data-level="-1" aria-live="polite"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="strength-label"></span></div>`;

export function generatePassword(length = 18) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}
