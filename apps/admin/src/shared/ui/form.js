import { toastError } from "./toast.js";

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

function showFormError(error, message) {
  if (!error) return false;
  error.textContent = message;
  error.hidden = false;
  return true;
}

function reportInvalid(form, error) {
  const invalid = form.querySelector(":invalid");
  invalid?.focus();
  if (invalid) showFormError(error, invalid.validationMessage);
}

export function bindForm(form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = form.querySelector(".form-error");
    if (error) error.hidden = true;
    if (!form.checkValidity()) return reportInvalid(form, error);
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    try {
      await handler(form);
    } catch (failure) {
      if (!showFormError(error, failure.message)) toastError(failure);
    } finally {
      if (document.contains(button)) setBusy(button, false);
    }
  });
}
