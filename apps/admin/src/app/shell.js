import { $, html, mount } from "../shared/lib/html.js";
import { icon, iconMarkup } from "../shared/lib/icons.js";
import { initials, roleLabels } from "../shared/ui/labels.js";
import { toast } from "../shared/ui/toast.js";
import { byId, isVisible, renderCurrent, sections } from "./router.js";
import { state, store } from "./state.js";

export function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((element) => {
    element.outerHTML = iconMarkup(element.dataset.icon);
  });
}

export function show(screen) {
  $("boot").hidden = screen !== "boot";
  $("authScreen").hidden = screen !== "auth";
  $("appShell").hidden = screen !== "app";
}

export function renderUser() {
  const user = state.user;
  const name = user?.displayName || user?.username || state.identity?.label || "";
  const role = roleLabels[state.identity?.role] || "";
  $("userAvatar").textContent = initials(name);
  $("userName").textContent = name;
  $("userRole").textContent = role;
  mount(
    $("userMenuHeader"),
    html`<span class="avatar large" aria-hidden="true">${initials(name)}</span><div><b>${name}</b><span class="muted">@${user?.username || ""} · ${role}</span></div>`,
  );
  $("brandVersion").textContent = state.health?.version ? `v${state.health.version}` : "";
}

export function renderNav() {
  mount(
    $("nav"),
    sections.map((section) => {
      const items = section.views.map((id) => byId[id]).filter(isVisible);
      if (!items.length) return "";
      return html`<div class="nav-section"><p class="nav-label" id="nav-${section.id}">${section.label}</p>
      <ul aria-labelledby="nav-${section.id}">${items.map((view) => html`<li><a href="#/${view.id}" data-view="${view.id}">${icon(view.icon)}<span>${view.label}</span></a></li>`)}</ul></div>`;
    }),
  );
}

export function renderServerStatus() {
  const h = state.health;
  mount(
    $("serverStatus"),
    h
      ? html`<span class="status-dot ok" aria-hidden="true"></span><div><b>Servidor en línea</b><span>${h.publicUrl || location.host} · firmas ${h.signaturePolicy}</span></div>`
      : html`<span class="status-dot warn" aria-hidden="true"></span><div><b>Estado desconocido</b><span>No se pudo leer /health</span></div>`,
  );
}

export function initShell() {
  hydrateIcons();
  $("themeSelect").value = window.modaiTheme.get();
  $("themeSelect").addEventListener("change", (event) => window.modaiTheme.set(event.target.value));
  $("refreshButton").addEventListener("click", async () => {
    store.invalidate();
    await renderCurrent();
    toast("Datos actualizados", "info");
  });
}
