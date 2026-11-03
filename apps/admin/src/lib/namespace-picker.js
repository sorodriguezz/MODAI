// Search combobox shared by the wizards (namespaces, categories): focus it and the options drop down; typing
// narrows them. Only an existing option can be chosen, so a typo never points at a new one. The chosen value
// lives in a hidden input with the field's `id`. Options are strings or { value, hint } (the hint is shown under it).
import { html } from "./html.js";
import { icon } from "./icons.js";

const valueOf = (option) => (typeof option === "string" ? option : option.value);

/**
 * `id` is the (hidden) value input; the visible combobox is `${id}Input`.
 * `required: false` lets the person clear it (the empty value means "default"), described by `hint`.
 */
export function comboField({ id, label, options, selected = "", readonly = false, required = true, placeholder = "Selecciona…", emptyText = "No hay opciones disponibles", emptyHint = "", hint = "" }) {
  if (readonly) return html`<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${selected}" readonly></div>`;
  if (!options.length) {
    return html`<div class="field"><label for="${id}Input">${label}</label><div class="combo"><input id="${id}Input" class="combo-input" ${required ? "required" : ""} disabled placeholder="${emptyText}"><input type="hidden" id="${id}" value=""></div>
      ${emptyHint ? html`<p class="hint">${emptyHint}</p>` : ""}</div>`;
  }
  const value = options.some((option) => valueOf(option) === selected) ? selected : "";
  return html`<div class="field"><label for="${id}Input">${label}</label>
    <div class="combo">
      <input id="${id}Input" class="combo-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}List" autocomplete="off" spellcheck="false" autocapitalize="off" ${required ? "required" : ""} placeholder="${placeholder}" value="${value}">
      <span class="combo-icon" aria-hidden="true">${icon("search", 16)}</span>
      <ul id="${id}List" class="combo-list" role="listbox" hidden></ul>
      <input type="hidden" id="${id}" value="${value}">
    </div>${hint ? html`<p class="hint">${hint}</p>` : ""}</div>`;
}

/** Wires the combobox: open on click, filter while typing, arrows/Enter/Esc, and revert unfinished text on blur. */
export function bindComboSearch(root, id, options, { required = true } = {}) {
  const input = root.querySelector("#" + id + "Input");
  const value = root.querySelector("#" + id);
  const list = root.querySelector("#" + id + "List");
  if (!input || !value || !list || input.disabled) return;
  const all = options.map((option) => (typeof option === "string" ? { value: option } : option));
  let active = -1;
  let shown = [];

  // The list is fixed to the viewport so a scrolling dialog body never clips it; it opens upwards when below is short.
  const place = () => {
    const box = input.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - 12, above = box.top - 12;
    const up = below < Math.min(list.scrollHeight, 232) && above > below;
    Object.assign(list.style, { position: "fixed", left: box.left + "px", width: box.width + "px", right: "auto",
      top: up ? "auto" : box.bottom + 6 + "px", bottom: up ? window.innerHeight - box.top + 6 + "px" : "auto",
      maxHeight: Math.max(120, Math.min(320, up ? above : below)) + "px" });
  };
  const follow = () => { if (!list.hidden) place(); };
  const close = () => {
    list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1;
    window.removeEventListener("scroll", follow, true); window.removeEventListener("resize", follow);
  };
  const highlight = (index) => {
    active = index;
    [...list.children].forEach((item, i) => { item.classList.toggle("active", i === index); item.setAttribute("aria-selected", String(i === index)); });
    const item = list.children[index];
    if (item) { input.setAttribute("aria-activedescendant", item.id); item.scrollIntoView({ block: "nearest" }); }
  };
  const render = (query) => {
    const q = query.trim().toLocaleLowerCase();
    shown = all.filter((option) => !q || `${option.value} ${option.hint || ""}`.toLocaleLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown.map((option, i) => {
      const item = document.createElement("li");
      item.id = `${id}Option${i}`; item.setAttribute("role", "option"); item.dataset.value = option.value;
      item.append(Object.assign(document.createElement("span"), { className: "combo-value", textContent: option.value }));
      if (option.hint) item.append(Object.assign(document.createElement("span"), { className: "combo-hint", textContent: option.hint }));
      if (option.value === value.value) item.classList.add("selected");
      return item;
    }) : [Object.assign(document.createElement("li"), { className: "empty", textContent: "Sin coincidencias" })]));
    if (list.hidden) { window.addEventListener("scroll", follow, true); window.addEventListener("resize", follow); }
    list.hidden = false; input.setAttribute("aria-expanded", "true");
    place();
    highlight(shown.length ? Math.max(0, shown.findIndex((option) => option.value === value.value)) : -1);
  };
  const choose = (name) => {
    value.value = name; input.value = name; close();
    input.setCustomValidity("");
    value.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Opens on click (not on focus: a wizard may focus its first field on entry) and shows every option;
  // typing narrows them, and ArrowDown opens it from the keyboard.
  input.addEventListener("click", () => { if (list.hidden) { render(""); input.select(); } });
  input.addEventListener("input", () => { value.value = ""; render(input.value); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) return render(input.value);
      if (shown.length) highlight((active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
    } else if (event.key === "Enter" && !list.hidden && shown[active]) { event.preventDefault(); choose(shown[active].value); }
    else if (event.key === "Escape" && !list.hidden) { event.stopPropagation(); close(); }
  });
  // mousedown (not click) so the choice lands before the input loses focus.
  list.addEventListener("mousedown", (event) => {
    const item = event.target.closest("li[data-value]");
    if (item) { event.preventDefault(); choose(item.dataset.value); }
  });
  input.addEventListener("blur", () => {
    close();
    // An optional field emptied by the person goes back to "default".
    if (!required && !input.value.trim() && value.value) { choose(""); return; }
    input.value = value.value;
  });
}

/** `names` are the namespaces the person may publish to. */
export function namespaceField({ id, label = "Namespace", names, selected = "", readonly = false }) {
  return comboField({ id, label, options: names, selected, readonly, placeholder: "Selecciona un namespace", emptyText: "No hay namespaces disponibles",
    emptyHint: html`Crea uno primero en el menú <b>Namespaces</b> o pide acceso a la administración de su organización.` });
}

export function bindNamespaceSearch(root, id, names) {
  bindComboSearch(root, id, names);
}

/**
 * Category chooser: the categories registered in the Categorías menu, with their description. Optional: left empty,
 * the package keeps the default of its type (`fallback`). `categories` comes from GET /categories.
 */
export function categoryField({ id, categories, selected = "", fallback = "general" }) {
  const options = categories.filter((item) => item.registered).map((item) => ({ value: item.name, hint: item.description }));
  if (selected && !options.some((option) => option.value === selected)) options.unshift({ value: selected, hint: "Sin registrar en Categorías" });
  return comboField({ id, label: "Categoría", options, selected, required: false, placeholder: `Por defecto: ${fallback}`, emptyText: `Por defecto: ${fallback}`,
    emptyHint: "Aún no hay categorías registradas: la administración las crea en el menú Categorías.",
    hint: html`Sirve para filtrar el catálogo y para <code>modai list &lt;categoría&gt;</code>. Vacía, se usa <code>${fallback}</code>. Las categorías se gestionan en el menú <b>Categorías</b>.` });
}

export function bindCategorySearch(root, id, categories, selected = "") {
  const options = categories.filter((item) => item.registered).map((item) => ({ value: item.name, hint: item.description }));
  if (selected && !options.some((option) => option.value === selected)) options.unshift({ value: selected, hint: "Sin registrar en Categorías" });
  bindComboSearch(root, id, options, { required: false });
}
