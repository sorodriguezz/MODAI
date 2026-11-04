import { $, html, mount } from "../lib/html.js";
import { bindForm } from "./form.js";

let returnFocus = null;

export function openDialog({ title, description, body, size = "md", onClose } = {}) {
  const dialog = $("dialog");
  if (!dialog.open) returnFocus = document.activeElement;
  dialog.className = `dialog size-${size}`;
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
  requestAnimationFrame(() =>
    (
      container.querySelector("[autofocus], input:not([type=hidden]), select, textarea") ||
      container.querySelector("button") ||
      dialog.querySelector(".dialog-close")
    )?.focus(),
  );
  return container;
}

export function closeDialog() {
  const dialog = $("dialog");
  if (dialog.open) dialog.close();
}

export function closeDialogAndWait() {
  const dialog = $("dialog");
  if (!dialog.open) return Promise.resolve();
  return new Promise((resolve) => {
    dialog.addEventListener("close", resolve, { once: true });
    dialog.close();
  });
}

export function initDialog() {
  const dialog = $("dialog");
  dialog.querySelector(".dialog-close").addEventListener("click", closeDialog);
  // why: a modal only closes from its own buttons, so Escape or a backdrop click never discards what was typed.
  dialog.addEventListener("cancel", (event) => event.preventDefault());
}

const typedField = (typed) =>
  typed
    ? html`<div class="field"><label for="confirmTyped">Escribe <code>${typed}</code> para confirmar</label><input id="confirmTyped" autocomplete="off" spellcheck="false" required></div>`
    : "";

export function confirmDialog({ title, message, confirmLabel = "Confirmar", danger = true, typed, action }) {
  return new Promise((resolve) => {
    let done = false;
    const body = openDialog({
      title,
      size: "sm",
      onClose: () => !done && resolve(false),
      body: html`<form class="stack" novalidate>
        <p class="dialog-message">${message}</p>
        ${typedField(typed)}
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
      input.addEventListener("input", () => {
        submitButton.disabled = input.value !== typed;
      });
    } else requestAnimationFrame(() => form.querySelector("[data-dismiss]").focus());
    bindForm(form, async () => {
      if (action) await action();
      done = true;
      closeDialog();
      resolve(true);
    });
  });
}

function promptInput({ multiline, placeholder, value, required }) {
  return multiline
    ? html`<textarea id="promptValue" rows="3" placeholder="${placeholder}" ${required ? "required" : ""}>${value}</textarea>`
    : html`<input id="promptValue" placeholder="${placeholder}" value="${value}" ${required ? "required" : ""}>`;
}

export function promptDialog({
  title,
  message,
  label,
  placeholder = "",
  value = "",
  confirmLabel = "Guardar",
  danger = false,
  required = true,
  multiline = false,
  action,
}) {
  return new Promise((resolve) => {
    let done = false;
    const body = openDialog({
      title,
      size: "sm",
      onClose: () => !done && resolve(null),
      body: html`<form class="stack" novalidate>
        ${message ? html`<p class="dialog-message">${message}</p>` : ""}
        <div class="field"><label for="promptValue">${label}</label>
          ${promptInput({ multiline, placeholder, value, required })}
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
