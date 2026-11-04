import { html, mount, toMarkup } from "./html.js";

function button(className, text) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  return element;
}

function controls(form) {
  const submit = form.querySelector('button[type="submit"]');
  const nav = document.createElement("ol");
  nav.className = "wizard-steps";
  nav.setAttribute("aria-label", "Pasos");
  form.prepend(nav);
  const back = button("btn ghost", "Atrás");
  const next = button("btn primary", "Siguiente");
  submit.before(back, next);
  return { submit, nav, back, next, error: form.querySelector(".form-error") };
}

function stepClass(i, index, reached) {
  if (i === index) return "current";
  return i < reached || i < index ? "done" : "";
}

function drawSteps(nav, sections, index, reached, skipped) {
  let shown = 0;
  mount(
    nav,
    sections.map((section, i) =>
      skipped(i)
        ? ""
        : html`<li class="${stepClass(i, index, reached)}"><button type="button" data-step-index="${i}" aria-current="${i === index ? "step" : "false"}"><span class="wizard-number">${++shown}</span><span class="wizard-title">${section.dataset.title}</span></button></li>`,
    ),
  );
}

function firstInvalid(section) {
  return [...section.querySelectorAll("input, select, textarea")].find(
    (field) => !field.closest("[hidden]") && !field.checkValidity(),
  );
}

export function wizard(form, { validate = {}, onEnter = {}, skip = {}, start = 0 } = {}) {
  const sections = [...form.querySelectorAll(":scope [data-step]")];
  const { submit, nav, back, next, error } = controls(form);
  let current = -1;
  let reached = start;
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
    const invalid = firstInvalid(sections[index]);
    if (invalid) return fail(invalid.validationMessage, invalid);
    const message = validate[sections[index].dataset.step]?.(form);
    return message ? fail(message) : true;
  };
  const show = (index, { keepError = false } = {}) => {
    if (error && !keepError) error.hidden = true;
    current = index;
    reached = Math.max(reached, index);
    sections.forEach((section, i) => {
      section.hidden = i !== index;
    });
    drawSteps(nav, sections, index, reached, skipped);
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
    for (let i = current; i < index; i++) {
      if (check(i)) continue;
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
  // why: capture phase runs before bindForm's submit handler, so Enter on an early step only advances.
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

function reviewValue(value) {
  if (value === "" || value === undefined || (Array.isArray(value) && !value.length))
    return html`<span class="muted">—</span>`;
  return Array.isArray(value) ? value.join(", ") : value;
}

export function reviewList(items) {
  return toMarkup(
    html`<dl class="definition-grid single review">${items.map(([label, value]) => html`<div><dt>${label}</dt><dd>${reviewValue(value)}</dd></div>`)}</dl>`,
  );
}
