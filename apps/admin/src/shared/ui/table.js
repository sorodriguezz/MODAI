import { html } from "../lib/html.js";

export const optionalColumn = (label) => ({ label, className: "hide-sm" });

export const actionsColumn = (label = "Acciones") => ({ label: html`<span class="sr-only">${label}</span>` });

function headerCell(column) {
  const { label, className } = typeof column === "string" ? { label: column } : column;
  return className ? html`<th scope="col" class="${className}">${label}</th>` : html`<th scope="col">${label}</th>`;
}

export function dataTable(columns, rows) {
  return html`<div class="table-wrap"><table class="table">
    <thead><tr>${columns.filter(Boolean).map(headerCell)}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
