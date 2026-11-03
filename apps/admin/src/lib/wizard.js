// Step-by-step forms: every <section data-step data-title> of a form becomes one step, shown one at a time,
// with a clickable stepper, Back/Next and the form's own submit button on the last step. Enter advances.
import { html, mount, toMarkup } from "./html.js";

/**
 * @param {HTMLFormElement} form
 * @param {{ validate?: Record<string, (form: HTMLFormElement) => string | void>, onEnter?: Record<string, (form: HTMLFormElement) => void>, skip?: Record<string, (form: HTMLFormElement) => boolean>, start?: number }} options
 *   `skip` hides a step while its predicate is true (for example, grant steps when a key inherits its owner's).
 */
export function wizard(form, { validate = {}, onEnter = {}, skip = {}, start = 0 } = {}) {
  const sections = [...form.querySelectorAll(":scope [data-step]")];
  const submit = form.querySelector('button[type="submit"]');
  const error = form.querySelector(".form-error");
  const nav = document.createElement("ol");
  nav.className = "wizard-steps";
  nav.setAttribute("aria-label", "Pasos");
  form.prepend(nav);
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn ghost";
  back.textContent = "Atrás";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn primary";
  next.textContent = "Siguiente";
  submit.before(back, next);
  let current = -1,
    reached = start;

  const fail = (message, focus) => {
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    focus?.focus();
    return false;
  };
  const skipped = (index) => Boolean(skip[sections[index].dataset.step]?.(form));
  const step = (from, direction) => {
    let i = from + direction;
    while (i > 0 && i < sections.length - 1 && skipped(i)) i += direction;
    return i;
  };
  const check = (index) => {
    if (skipped(index)) return true;
    const section = sections[index];
    const invalid = [...section.querySelectorAll("input, select, textarea")].find(
      (field) => !field.closest("[hidden]") && !field.checkValidity(),
    );
    if (invalid) return fail(invalid.validationMessage, invalid);
    const message = validate[section.dataset.step]?.(form);
    return message ? fail(message) : true;
  };
  const show = (index, { keepError = false } = {}) => {
    if (error && !keepError) error.hidden = true;
    current = index;
    reached = Math.max(reached, index);
    sections.forEach((section, i) => {
      section.hidden = i !== index;
    });
    let shown = 0;
    mount(
      nav,
      sections.map((section, i) =>
        skipped(i)
          ? ""
          : html`<li class="${i === index ? "current" : i < reached || i < index ? "done" : ""}"><button type="button" data-step-index="${i}" aria-current="${i === index ? "step" : "false"}"><span class="wizard-number">${++shown}</span><span class="wizard-title">${section.dataset.title}</span></button></li>`,
      ),
    );
    const last = index === sections.length - 1;
    back.hidden = index === 0;
    next.hidden = last;
    submit.hidden = !last;
    onEnter[sections[index].dataset.step]?.(form);
    requestAnimationFrame(() =>
      sections[index].querySelector("input:not([type=hidden]):not([disabled]), select, textarea")?.focus(),
    );
  };
  const go = (index) => {
    // On a failed step, show it and keep its error (check() already filled it in).
    if (index > current)
      for (let i = current; i < index; i++)
        if (!check(i)) {
          if (i !== current) show(i, { keepError: true });
          return;
        }
    show(index);
  };
  next.addEventListener("click", () => go(step(current, 1)));
  back.addEventListener("click", () => show(step(current, -1)));
  nav.addEventListener("click", (event) => {
    const target = event.target.closest("[data-step-index]");
    if (target) go(Number(target.dataset.stepIndex));
  });
  // Capture phase: runs before bindForm's submit handler, so Enter on an early step only advances.
  form.addEventListener(
    "submit",
    (event) => {
      if (current === sections.length - 1) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      go(step(current, 1));
    },
    true,
  );
  show(start);
  return {
    show,
    go,
    get current() {
      return current;
    },
  };
}

/** Definition list for a review step. Items with an empty value show "—". */
export function reviewList(items) {
  return toMarkup(
    html`<dl class="definition-grid single review">${items.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value === "" || value === undefined || (Array.isArray(value) && !value.length) ? html`<span class="muted">—</span>` : Array.isArray(value) ? value.join(", ") : value}</dd></div>`)}</dl>`,
  );
}
