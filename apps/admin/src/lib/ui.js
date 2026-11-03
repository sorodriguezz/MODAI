import { html, mount, raw, $, esc } from "./html.js";
import { icon, iconMarkup } from "./icons.js";

// ------------------------------------------------------------------ format

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
const relativeFormat = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function formatDate(value, empty = "—") {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? empty : dateFormat.format(date);
}

export function relativeTime(value, empty = "Nunca") {
  if (!value) return empty;
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  return "hace un momento";
}

export function timeTag(value, empty) {
  return value ? html`<time datetime="${value}" title="${formatDate(value)}">${relativeTime(value, empty)}</time>` : html`<span class="muted">${empty ?? "Nunca"}</span>`;
}

export function csv(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function initials(name) {
  return String(name || "?").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "?";
}

// ------------------------------------------------------------------ labels

export const roleLabels = { admin: "Administración global", "org-admin": "Administración de organización", publisher: "Publicación", worker: "Worker", reader: "Lectura" };
export const roleDescriptions = {
  reader: "Consulta catálogo, conocimiento y la memoria de sus proyectos.",
  publisher: "Además publica paquetes y conocimiento, crea proyectos, guarda memoria y envía tareas.",
  worker: "Pensado para workers: reclama y completa ejecuciones de sus proyectos.",
  "org-admin": "Gestiona usuarios, API keys, proyectos y namespaces de sus organizaciones, y publica en sus namespaces.",
  admin: "Control total: todas las organizaciones, auditoría, backups y retención.",
};

export function roleBadge(role) {
  return html`<span class="badge role-${role}">${roleLabels[role] || role}</span>`;
}

const statusTone = { active: "success", completed: "success", deprecated: "warning", queued: "neutral", running: "info", yanked: "danger", failed: "danger", cancelled: "neutral" };
const statusLabels = { active: "Activa", deprecated: "Deprecada", yanked: "Retirada", queued: "En cola", running: "En curso", completed: "Completada", failed: "Fallida", cancelled: "Cancelada" };
export function statusBadge(status) {
  return html`<span class="badge tone-${statusTone[status] || "neutral"}"><span class="dot" aria-hidden="true"></span>${statusLabels[status] || status}</span>`;
}

// ------------------------------------------------------------------ toasts

export function toast(message, tone = "success") {
  const region = $("toasts");
  const item = document.createElement("div");
  item.className = "toast tone-" + tone;
  item.setAttribute("role", tone === "error" ? "alert" : "status");
  mount(item, html`${icon(tone === "error" ? "alert" : tone === "info" ? "info" : "check")}<span>${message}</span><button class="icon-button small" type="button" aria-label="Cerrar notificación">${icon("x", 16)}</button>`);
  const close = () => {
    item.classList.add("leaving");
    setTimeout(() => item.remove(), 180);
  };
  item.querySelector("button").addEventListener("click", close);
  region.append(item);
  while (region.children.length > 4) region.firstElementChild.remove();
  setTimeout(close, tone === "error" ? 8000 : 4500);
}
export const toastError = (error) => toast(error?.message || String(error), "error");

// ------------------------------------------------------------------ dialogs

let returnFocus = null;

/**
 * Opens the shared modal dialog. `body` is an html`` fragment. Returns the body element.
 * Native <dialog> traps focus, closes on Escape and makes the page inert.
 */
export function openDialog({ title, description, body, size = "md", onClose } = {}) {
  const dialog = $("dialog");
  if (!dialog.open) returnFocus = document.activeElement;
  dialog.className = "dialog size-" + size;
  $("dialogTitle").textContent = title;
  $("dialogDescription").textContent = description || "";
  $("dialogDescription").hidden = !description;
  const container = $("dialogBody");
  mount(container, body);
  dialog.onclose = () => {
    mount(container, "");
    onClose?.();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  };
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => (container.querySelector("[autofocus], input:not([type=hidden]), select, textarea") || container.querySelector("button") || dialog.querySelector(".dialog-close"))?.focus());
  return container;
}

export function closeDialog() {
  const dialog = $("dialog");
  if (dialog.open) dialog.close();
}

/** Closes the shared dialog and resolves once its (async) close handler cleared it, so another dialog can open next. */
export function closeDialogAndWait() {
  const dialog = $("dialog");
  if (!dialog.open) return Promise.resolve();
  return new Promise((resolve) => { dialog.addEventListener("close", resolve, { once: true }); dialog.close(); });
}

export function initDialog() {
  const dialog = $("dialog");
  dialog.querySelector(".dialog-close").addEventListener("click", closeDialog);
  // Click on the backdrop closes the dialog.
  dialog.addEventListener("mousedown", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
  });
}

/**
 * Confirmation for destructive actions. With `typed`, the user must type that exact text.
 * `action` runs while the button shows a spinner; errors stay in the dialog.
 */
export function confirmDialog({ title, message, confirmLabel = "Confirmar", danger = true, typed, action }) {
  return new Promise((resolve) => {
    let done = false;
    const body = openDialog({
      title,
      size: "sm",
      onClose: () => !done && resolve(false),
      body: html`<form class="stack" novalidate>
        <p class="dialog-message">${message}</p>
        ${typed ? html`<div class="field"><label for="confirmTyped">Escribe <code>${typed}</code> para confirmar</label><input id="confirmTyped" autocomplete="off" spellcheck="false" required></div>` : ""}
        <div class="form-error" role="alert" hidden></div>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" data-dismiss>Cancelar</button>
          <button type="submit" class="btn ${danger ? "danger" : "primary"}" ${typed ? "disabled" : ""}>${confirmLabel}</button>
        </div>
      </form>`,
    });
    const form = body.querySelector("form");
    const submitButton = form.querySelector('button[type="submit"]');
    form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
    if (typed) {
      const input = form.querySelector("#confirmTyped");
      input.addEventListener("input", () => (submitButton.disabled = input.value !== typed));
    } else requestAnimationFrame(() => form.querySelector("[data-dismiss]").focus());
    bindForm(form, async () => {
      if (action) await action();
      done = true;
      closeDialog();
      resolve(true);
    });
  });
}

/** Simple one-field prompt (e.g. deprecation message). Resolves to the value or null. */
export function promptDialog({ title, message, label, placeholder = "", value = "", confirmLabel = "Guardar", danger = false, required = true, multiline = false, action }) {
  return new Promise((resolve) => {
    let done = false;
    const body = openDialog({
      title,
      size: "sm",
      onClose: () => !done && resolve(null),
      body: html`<form class="stack" novalidate>
        ${message ? html`<p class="dialog-message">${message}</p>` : ""}
        <div class="field"><label for="promptValue">${label}</label>
          ${multiline ? html`<textarea id="promptValue" rows="3" placeholder="${placeholder}" ${required ? "required" : ""}>${value}</textarea>` : html`<input id="promptValue" placeholder="${placeholder}" value="${value}" ${required ? "required" : ""}>`}
        </div>
        <div class="form-error" role="alert" hidden></div>
        <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn ${danger ? "danger" : "primary"}">${confirmLabel}</button></div>
      </form>`,
    });
    const form = body.querySelector("form");
    form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
    bindForm(form, async () => {
      const result = form.querySelector("#promptValue").value.trim();
      if (required && !result) throw new Error("Este campo es obligatorio.");
      if (action) await action(result);
      done = true;
      closeDialog();
      resolve(result);
    });
  });
}

// ------------------------------------------------------------------ forms

/**
 * Wires a form: native validation, disabled submit with spinner, inline error (`.form-error`).
 * `handler(form)` may throw; its message is shown inside the form.
 */
export function bindForm(form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = form.querySelector(".form-error");
    if (error) error.hidden = true;
    if (!form.checkValidity()) {
      const invalid = form.querySelector(":invalid");
      invalid?.focus();
      if (error && invalid) {
        error.textContent = invalid.validationMessage;
        error.hidden = false;
      }
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    try {
      await handler(form);
    } catch (failure) {
      if (error) {
        error.textContent = failure.message;
        error.hidden = false;
      } else toastError(failure);
    } finally {
      if (document.contains(button)) setBusy(button, false);
    }
  });
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

/** Password input with show/hide toggle. */
export function passwordField({ id, label, autocomplete = "current-password", hint, minlength, value = "", required = true }) {
  return html`<div class="field">
    <label for="${id}">${label}</label>
    <div class="input-group">
      <input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" ${minlength ? raw('minlength="' + Number(minlength) + '"') : ""} value="${value}" ${required ? "required" : ""} ${hint ? raw('aria-describedby="' + esc(id) + 'Hint"') : ""} spellcheck="false" autocapitalize="off">
      <button type="button" class="input-addon" data-toggle-password="${id}" aria-label="Mostrar contraseña" aria-pressed="false">${icon("eye")}</button>
    </div>
    ${hint ? html`<p class="hint" id="${id}Hint">${hint}</p>` : ""}
  </div>`;
}

// Global handler for every show/hide password toggle.
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

export function passwordStrength(password) {
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const level = password.length < 10 ? 0 : Math.min(3, Math.max(1, score - 1));
  return { level, label: ["Muy corta", "Aceptable", "Buena", "Excelente"][level] };
}

/** Live strength meter bound to an input. */
export function bindStrength(input, meter) {
  const update = () => {
    const { level, label } = passwordStrength(input.value);
    meter.dataset.level = String(input.value ? level : -1);
    meter.querySelector(".strength-label").textContent = input.value ? label : "";
  };
  input.addEventListener("input", update);
  update();
}
export const strengthMeter = (id) => html`<div class="strength" id="${id}" data-level="-1" aria-live="polite"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="strength-label"></span></div>`;

export function generatePassword(length = 18) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.!";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

// ------------------------------------------------------------------ states

export function skeletonRows(rows = 5, columns = 4) {
  return html`<div class="skeleton-table" aria-hidden="true">${Array.from({ length: rows }, () => html`<div class="skeleton-row">${Array.from({ length: columns }, (_, i) => html`<span class="skeleton" style="width:${[38, 22, 18, 14][i % 4]}%"></span>`)}</div>`)}</div><span class="sr-only">Cargando…</span>`;
}

export function skeletonCards(count = 6) {
  return html`<div class="card-grid" aria-hidden="true">${Array.from({ length: count }, () => html`<div class="card"><span class="skeleton" style="width:40px;height:40px;border-radius:10px"></span><span class="skeleton" style="width:70%;height:16px;margin-top:16px"></span><span class="skeleton" style="width:95%"></span><span class="skeleton" style="width:60%"></span></div>`)}</div><span class="sr-only">Cargando…</span>`;
}

export function emptyState({ iconName = "package", title, text, action }) {
  return html`<div class="empty-state"><span class="empty-icon">${icon(iconName, 26)}</span><h3>${title}</h3>${text ? html`<p>${text}</p>` : ""}${action || ""}</div>`;
}

export function errorState(error, retryAction = "retry") {
  return html`<div class="empty-state error"><span class="empty-icon">${icon("alert", 26)}</span><h3>No se pudo cargar</h3><p>${error.message}</p><button class="btn" data-action="${retryAction}">${icon("refresh")}Reintentar</button></div>`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copiado al portapapeles");
  } catch {
    toast("No se pudo copiar. Selecciona el texto y cópialo manualmente.", "error");
  }
}

export function codeBlock(id, text, copyLabel = "Copiar") {
  return html`<div class="code-block"><pre id="${id}">${text}</pre><button type="button" class="btn small ghost copy-button" data-copy="${id}">${icon("copy", 16)}${copyLabel}</button></div>`;
}

// Global copy handler: <button data-copy="elementId">.
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  const source = document.getElementById(button.dataset.copy);
  if (source) copyText(source.textContent);
});

/** Debounce helper for search inputs. */
export function debounce(fn, ms = 160) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Segmented tabs inside a container: buttons [data-tab] toggle panels [data-panel]. */
export function bindTabs(root, onChange) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      root.querySelector('[role="tabpanel"][data-panel="' + item.dataset.tab + '"]').hidden = !active;
    });
    onChange?.(tab.dataset.tab);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!delta) return;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  });
}
