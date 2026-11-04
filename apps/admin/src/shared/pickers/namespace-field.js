import { html } from "../lib/html.js";
import { bindComboSearch, comboField } from "./combo-field.js";

export function namespaceField({ id, label = "Namespace", names, selected = "", readonly = false }) {
  return comboField({
    id,
    label,
    options: names,
    selected,
    readonly,
    placeholder: "Selecciona un namespace",
    emptyText: "No hay namespaces disponibles",
    emptyHint: html`Crea uno primero en el menú <b>Namespaces</b> o pide acceso a la administración de su organización.`,
  });
}

export function bindNamespaceSearch(root, id, names) {
  bindComboSearch(root, id, names);
}
