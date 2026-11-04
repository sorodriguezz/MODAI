import { html } from "../lib/html.js";

const WIDTHS = [38, 22, 18, 14];

export function skeletonRows(rows = 5, columns = 4) {
  return html`<div class="skeleton-table" aria-hidden="true">${Array.from({ length: rows }, () => html`<div class="skeleton-row">${Array.from({ length: columns }, (_, i) => html`<span class="skeleton" style="width:${WIDTHS[i % 4]}%"></span>`)}</div>`)}</div><span class="sr-only">Cargando…</span>`;
}

export function skeletonCards(count = 6) {
  return html`<div class="card-grid" aria-hidden="true">${Array.from({ length: count }, () => html`<div class="card"><span class="skeleton" style="width:40px;height:40px;border-radius:10px"></span><span class="skeleton" style="width:70%;height:16px;margin-top:16px"></span><span class="skeleton" style="width:95%"></span><span class="skeleton" style="width:60%"></span></div>`)}</div><span class="sr-only">Cargando…</span>`;
}
