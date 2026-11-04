import { html } from "../../../shared/lib/html.js";

export function pager(page, pages) {
  if (pages <= 1) return "";
  return html`<nav class="pager" aria-label="Páginas del catálogo">
    <button type="button" class="btn small" data-action="page" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Anterior</button>
    <span class="muted small" aria-current="page">Página ${page} de ${pages}</span>
    <button type="button" class="btn small" data-action="page" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Siguiente</button>
  </nav>`;
}
