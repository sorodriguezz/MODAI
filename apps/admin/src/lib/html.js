// Tiny safe templating: every interpolated value is escaped unless it was produced by html`` or raw().
const RAW = Symbol("raw");

export function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c],
  );
}

/** Marks trusted markup (icons, static fragments). Never pass server data here. */
export function raw(markup) {
  return { [RAW]: String(markup) };
}

function render(value) {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  if (typeof value === "object" && RAW in value) return value[RAW];
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => (out += render(value) + strings[index + 1]));
  return raw(out);
}

export function toMarkup(fragment) {
  return render(fragment);
}

/** Replaces the content of an element with a fragment. */
export function mount(element, fragment) {
  element.innerHTML = render(fragment);
  return element;
}

/** Creates a detached element from a fragment (first element child). */
export function element(fragment) {
  const template = document.createElement("template");
  template.innerHTML = render(fragment).trim();
  return template.content.firstElementChild;
}

/** Click delegation: <button data-action="name" data-id="…"> → actions.name(button, event). */
export function delegate(root, actions, type = "click") {
  root.addEventListener(type, (event) => {
    const target = event.target.closest("[data-action]");
    if (!target || !root.contains(target)) return;
    const action = actions[target.dataset.action];
    if (!action) return;
    if (target.tagName === "A") event.preventDefault();
    action(target, event);
  });
}

export const $ = (id) => document.getElementById(id);
