const span = (className, textContent) => Object.assign(document.createElement("span"), { className, textContent });

function optionItem(id, option, index, selected) {
  const item = document.createElement("li");
  item.id = `${id}Option${index}`;
  item.setAttribute("role", "option");
  item.dataset.value = option.value;
  item.append(span("combo-value", option.value));
  if (option.hint) item.append(span("combo-hint", option.hint));
  if (option.value === selected) item.classList.add("selected");
  return item;
}

function placeList(input, list) {
  const box = input.getBoundingClientRect();
  const below = window.innerHeight - box.bottom - 12;
  const above = box.top - 12;
  const up = below < Math.min(list.scrollHeight, 232) && above > below;
  Object.assign(list.style, {
    position: "fixed",
    left: `${box.left}px`,
    width: `${box.width}px`,
    right: "auto",
    top: up ? "auto" : `${box.bottom + 6}px`,
    bottom: up ? `${window.innerHeight - box.top + 6}px` : "auto",
    maxHeight: `${Math.max(120, Math.min(320, up ? above : below))}px`,
  });
}

export function comboList({ id, input, value, list, options }) {
  const all = options.map((option) => (typeof option === "string" ? { value: option } : option));
  const combo = { active: -1, shown: [] };
  const follow = () => {
    if (!list.hidden) placeList(input, list);
  };
  combo.close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    combo.active = -1;
    window.removeEventListener("scroll", follow, true);
    window.removeEventListener("resize", follow);
  };
  combo.highlight = (index) => {
    combo.active = index;
    [...list.children].forEach((item, i) => {
      item.classList.toggle("active", i === index);
      item.setAttribute("aria-selected", String(i === index));
    });
    const item = list.children[index];
    if (!item) return;
    input.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  };
  combo.render = (query) => {
    const q = query.trim().toLocaleLowerCase();
    combo.shown = all.filter((option) => !q || `${option.value} ${option.hint || ""}`.toLocaleLowerCase().includes(q));
    list.replaceChildren(
      ...(combo.shown.length
        ? combo.shown.map((option, i) => optionItem(id, option, i, value.value))
        : [Object.assign(document.createElement("li"), { className: "empty", textContent: "Sin coincidencias" })]),
    );
    if (list.hidden) {
      window.addEventListener("scroll", follow, true);
      window.addEventListener("resize", follow);
    }
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    placeList(input, list);
    const selected = combo.shown.findIndex((option) => option.value === value.value);
    combo.highlight(combo.shown.length ? Math.max(0, selected) : -1);
  };
  return combo;
}
