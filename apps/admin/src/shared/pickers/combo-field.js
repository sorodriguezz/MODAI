import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { comboList } from "./combo-list.js";

const optionValue = (option) => (typeof option === "string" ? option : option.value);
const hintOf = (hint) => (hint ? html`<p class="hint">${hint}</p>` : "");

export function comboField({
  id,
  label,
  options,
  selected = "",
  readonly = false,
  required = true,
  placeholder = "Selecciona…",
  emptyText = "No hay opciones disponibles",
  emptyHint = "",
  hint = "",
}) {
  if (readonly)
    return html`<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${selected}" readonly></div>`;
  if (!options.length) {
    return html`<div class="field"><label for="${id}Input">${label}</label><div class="combo"><input id="${id}Input" class="combo-input" ${required ? "required" : ""} disabled placeholder="${emptyText}"><input type="hidden" id="${id}" value=""></div>
      ${hintOf(emptyHint)}</div>`;
  }
  const value = options.some((option) => optionValue(option) === selected) ? selected : "";
  return html`<div class="field"><label for="${id}Input">${label}</label>
    <div class="combo">
      <input id="${id}Input" class="combo-input" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}List" autocomplete="off" spellcheck="false" autocapitalize="off" ${required ? "required" : ""} placeholder="${placeholder}" value="${value}">
      <span class="combo-icon" aria-hidden="true">${icon("search", 16)}</span>
      <ul id="${id}List" class="combo-list" role="listbox" hidden></ul>
      <input type="hidden" id="${id}" value="${value}">
    </div>${hintOf(hint)}</div>`;
}

function onKey(event, { input, list, combo, choose }) {
  const { shown, active } = combo;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (list.hidden) return combo.render(input.value);
    if (shown.length) combo.highlight((active + (event.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
  } else if (event.key === "Enter" && !list.hidden && shown[active]) {
    event.preventDefault();
    choose(shown[active].value);
  } else if (event.key === "Escape" && !list.hidden) {
    event.stopPropagation();
    combo.close();
  }
}

export function bindComboSearch(root, id, options, { required = true } = {}) {
  const input = root.querySelector(`#${id}Input`);
  const value = root.querySelector(`#${id}`);
  const list = root.querySelector(`#${id}List`);
  if (!input || !value || !list || input.disabled) return;
  const combo = comboList({ id, input, value, list, options });
  const choose = (name) => {
    value.value = name;
    input.value = name;
    combo.close();
    input.setCustomValidity("");
    value.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // why: opens on click, not focus, because a wizard may focus its first field on entry.
  input.addEventListener("click", () => {
    if (!list.hidden) return;
    combo.render("");
    input.select();
  });
  input.addEventListener("input", () => {
    value.value = "";
    combo.render(input.value);
  });
  input.addEventListener("keydown", (event) => onKey(event, { input, list, combo, choose }));
  list.addEventListener("mousedown", (event) => {
    const item = event.target.closest("li[data-value]");
    if (!item) return;
    event.preventDefault();
    choose(item.dataset.value);
  });
  input.addEventListener("blur", () => {
    combo.close();
    if (!required && !input.value.trim() && value.value) return choose("");
    input.value = value.value;
  });
}
