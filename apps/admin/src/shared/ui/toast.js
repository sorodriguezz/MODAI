import { $, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";

const TONE_ICONS = { error: "alert", info: "info" };

export function toast(message, tone = "success") {
  const region = $("toasts");
  const item = document.createElement("div");
  item.className = `toast tone-${tone}`;
  item.setAttribute("role", tone === "error" ? "alert" : "status");
  mount(
    item,
    html`${icon(TONE_ICONS[tone] || "check")}<span>${message}</span><button class="icon-button small" type="button" aria-label="Cerrar notificación">${icon("x", 16)}</button>`,
  );
  const close = () => {
    item.classList.add("leaving");
    setTimeout(() => item.remove(), 180);
  };
  item.querySelector("button").addEventListener("click", close);
  region.append(item);
  while (region.children.length > 4) region.firstElementChild.remove();
  setTimeout(close, tone === "error" ? 8000 : 4500);
}

export const toastError = (error) => toast(error?.message || String(error), "error");
