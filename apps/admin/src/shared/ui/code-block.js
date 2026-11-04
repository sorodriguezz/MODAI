import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { toast } from "./toast.js";

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copiado al portapapeles");
  } catch {
    toast("No se pudo copiar. Selecciona el texto y cópialo manualmente.", "error");
  }
}

export function codeBlock(id, text, copyLabel = "Copiar") {
  return html`<div class="code-block"><pre id="${id}">${text}</pre><button type="button" class="btn small ghost copy-button" data-copy="${id}">${icon("copy", 16)}${copyLabel}</button></div>`;
}

export function initCopyButtons() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const source = document.getElementById(button.dataset.copy);
    if (source) copyText(source.textContent);
  });
}
