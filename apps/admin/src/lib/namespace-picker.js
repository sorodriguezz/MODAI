// Namespace chooser shared by the package and template wizards: a search combobox. Focus it and the
// existing namespaces drop down; typing narrows them. Only an existing namespace can be chosen, so a typo
// never points at a new one. The chosen value lives in a hidden input with the field's `id`.
import { html } from "./html.js";
import { icon } from "./icons.js";

/** `id` is the (hidden) value input; the visible combobox is `${id}Input`. `names` are the namespaces the person may publish to. */
export function namespaceField({ id, label = "Namespace", names, selected = "", readonly = false }) {
  if (readonly) return html`<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${selected}" readonly></div>`;
  if (!names.length) {
    return html`<div class="field"><label for="${id}Input">${label}</label><div class="combo"><input id="${id}Input" class="combo-input" required disabled placeholder="No hay namespaces disponibles"><input type="hidden" id="${id}" value=""></div>
      <p class="hint">Crea uno primero en el menú <b>Namespaces</b> o pide acceso a la administración de su organización.</p></div>`;
  }
  const value = names.includes(selected) ? selected : "";
  return html`<div class="field"><label for="${id}Input">${label}</label>
    <div class="combo">
      <input id="${id}Input" class="combo-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}List" autocomplete="off" spellcheck="false" autocapitalize="off" required placeholder="Selecciona un namespace" value="${value}">
      <span class="combo-icon" aria-hidden="true">${icon("search", 16)}</span>
      <ul id="${id}List" class="combo-list" role="listbox" hidden></ul>
      <input type="hidden" id="${id}" value="${value}">
    </div></div>`;
}

/** Wires the combobox: open on click, filter while typing, arrows/Enter/Esc, and revert unfinished text on blur. */
export function bindNamespaceSearch(root, id, names) {
  const input = root.querySelector("#" + id + "Input");
  const value = root.querySelector("#" + id);
  const list = root.querySelector("#" + id + "List");
  if (!input || !value || !list || input.disabled) return;
  let active = -1;
  let shown = [];

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  const highlight = (index) => {
    active = index;
    [...list.children].forEach((item, i) => { item.classList.toggle("active", i === index); item.setAttribute("aria-selected", String(i === index)); });
    const item = list.children[index];
    if (item) { input.setAttribute("aria-activedescendant", item.id); item.scrollIntoView({ block: "nearest" }); }
  };
  const render = (query) => {
    const q = query.trim().toLocaleLowerCase();
    shown = names.filter((ns) => !q || ns.toLocaleLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map((ns, i) => {
      const item = document.createElement("li");
      item.id = `${id}Option${i}`; item.setAttribute("role", "option"); item.dataset.value = ns; item.textContent = ns;
      if (ns === value.value) item.classList.add("selected");
      return item;
    }) : [Object.assign(document.createElement("li"), { className: "empty", textContent: "Sin coincidencias" })]));
    list.hidden = false; input.setAttribute("aria-expanded", "true");
    highlight(shown.length ? Math.max(0, shown.indexOf(value.value)) : -1);
  };
  const choose = (name) => {
    value.value = name; input.value = name; close();
    input.setCustomValidity("");
    value.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Opens on click (not on focus: a wizard may focus its first field on entry) and shows every namespace;
  // typing narrows them, and ArrowDown opens it from the keyboard.
  input.addEventListener("click", () => { if (list.hidden) { render(""); input.select(); } });
  input.addEventListener("input", () => { value.value = ""; render(input.value); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) return render(input.value);
      if (shown.length) highlight((active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
    } else if (event.key === "Enter" && !list.hidden && shown[active]) { event.preventDefault(); choose(shown[active]); }
    else if (event.key === "Escape" && !list.hidden) { event.stopPropagation(); close(); }
  });
  // mousedown (not click) so the choice lands before the input loses focus.
  list.addEventListener("mousedown", (event) => {
    const item = event.target.closest("li[data-value]");
    if (item) { event.preventDefault(); choose(item.dataset.value); }
  });
  input.addEventListener("blur", () => { close(); input.value = value.value; });
}
