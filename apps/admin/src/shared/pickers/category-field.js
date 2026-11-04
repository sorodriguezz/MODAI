import { html } from "../lib/html.js";
import { bindComboSearch, comboField } from "./combo-field.js";

function categoryOptions(categories, selected) {
  const options = categories
    .filter((item) => item.registered)
    .map((item) => ({ value: item.name, hint: item.description }));
  if (selected && !options.some((option) => option.value === selected))
    options.unshift({ value: selected, hint: "Sin registrar en Categorías" });
  return options;
}

export function categoryField({ id, categories, selected = "", fallback = "general" }) {
  return comboField({
    id,
    label: "Categoría",
    options: categoryOptions(categories, selected),
    selected,
    required: false,
    placeholder: `Por defecto: ${fallback}`,
    emptyText: `Por defecto: ${fallback}`,
    emptyHint: "Aún no hay categorías registradas: la administración las crea en el menú Categorías.",
    hint: html`Sirve para filtrar el catálogo y para <code>modai list &lt;categoría&gt;</code>. Vacía, se usa <code>${fallback}</code>. Las categorías se gestionan en el menú <b>Categorías</b>.`,
  });
}

export function bindCategorySearch(root, id, categories, selected = "") {
  bindComboSearch(root, id, categoryOptions(categories, selected), { required: false });
}
