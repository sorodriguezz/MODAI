import { $ } from "../shared/lib/html.js";

export function toggleMenu(open) {
  document.body.classList.toggle("menu-open", open);
  $("menuToggle").setAttribute("aria-expanded", String(open));
  if (open) $("nav").querySelector("a")?.focus();
}

export function initSidebar() {
  $("menuToggle").addEventListener("click", () => toggleMenu(true));
  for (const element of document.querySelectorAll("[data-close-menu]"))
    element.addEventListener("click", () => {
      toggleMenu(false);
      $("menuToggle").focus();
    });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("menu-open")) toggleMenu(false);
  });
}
