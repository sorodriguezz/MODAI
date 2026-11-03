import { $, html, mount } from "./lib/html.js";
import { iconMarkup, icon } from "./lib/icons.js";
import { get, post, health } from "./lib/api.js";
import { initDialog, closeDialog, toast, toastError, roleLabels, initials } from "./lib/ui.js";
import { state, store } from "./state.js";
import { renderLogin, renderSetup } from "./views/auth.js";
import { openChangePassword } from "./views/account.js";
import dashboard from "./views/dashboard.js";
import packages from "./views/packages.js";
import agents from "./views/agents.js";
import knowledge from "./views/knowledge.js";
import projects from "./views/projects.js";
import memories from "./views/memories.js";
import runs from "./views/runs.js";
import users from "./views/users.js";
import access from "./views/access.js";
import audit from "./views/audit.js";
import connect from "./views/connect.js";
import organizations from "./views/organizations.js";
import namespaces from "./views/namespaces.js";
import templates from "./views/templates.js";
import myKeys from "./views/my-keys.js";

const views = [dashboard, packages, templates, agents, knowledge, projects, memories, runs, connect, myKeys, organizations, namespaces, users, access, audit];
const sections = [
  { id: "library", label: "Biblioteca", views: ["dashboard", "packages", "templates", "agents", "knowledge"] },
  { id: "work", label: "Proyectos", views: ["projects", "memories", "runs", "connect", "my-keys"] },
  { id: "admin", label: "Administración", views: ["organizations", "namespaces", "users", "access", "audit"] },
];
const byId = Object.fromEntries(views.map((view) => [view.id, view]));
let current = null;
let renderToken = 0;

// ------------------------------------------------------------------ static icons & theme

function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((element) => {
    element.outerHTML = iconMarkup(element.dataset.icon);
  });
}
hydrateIcons();
initDialog();
$("themeSelect").value = window.modaiTheme.get();
$("themeSelect").addEventListener("change", (event) => window.modaiTheme.set(event.target.value));

// ------------------------------------------------------------------ screens

function show(screen) {
  $("boot").hidden = screen !== "boot";
  $("authScreen").hidden = screen !== "auth";
  $("appShell").hidden = screen !== "app";
}

async function boot(notice) {
  show("boot");
  try {
    state.health = await health().catch(() => null);
    const status = await get("/auth/status");
    state.minPasswordLength = status.minPasswordLength || 10;
    if (status.setupRequired) return showSetup();
    if (!status.authenticated || status.identity?.kind !== "user") return showLogin(notice);
    await enterApp(status);
  } catch (error) {
    show("auth");
    mount($("authScreen"), html`<div class="auth-layout single"><section class="auth-main"><div class="auth-card"><div class="empty-state error"><span class="empty-icon">${icon("alert", 26)}</span><h3>No se pudo contactar con el servidor</h3><p>${error.message}</p><button class="btn primary" id="retryBoot">${icon("refresh")}Reintentar</button></div></div></section></div>`);
    $("retryBoot").addEventListener("click", () => boot());
  }
}

function showLogin(notice) {
  show("auth");
  renderLogin({ notice, onSuccess: () => boot() });
}

function showSetup() {
  show("auth");
  renderSetup({
    onSuccess: async () => {
      await boot();
      toast("Cuenta de administración creada. Ya puedes invitar a tu equipo desde Usuarios.");
    },
  });
}

async function enterApp(status) {
  state.identity = status.identity;
  state.user = status.user;
  state.permissions = status.permissions;
  store.invalidate();
  renderUser();
  renderNav();
  renderServerStatus();
  show("app");
  const target = parseHash();
  await navigate(target && isVisible(byId[target]) ? target : "dashboard", { replace: true });
}

window.addEventListener("modai:unauthorized", () => {
  if ($("appShell").hidden) return;
  closeDialog();
  state.identity = null;
  state.user = null;
  state.permissions = null;
  store.invalidate();
  showLogin("Tu sesión expiró o se cerró. Vuelve a iniciar sesión.");
});

// ------------------------------------------------------------------ shell

function isVisible(view) {
  return Boolean(view) && (!view.visible || view.visible());
}

function renderUser() {
  const user = state.user;
  const name = user?.displayName || user?.username || state.identity?.label || "";
  $("userAvatar").textContent = initials(name);
  $("userName").textContent = name;
  $("userRole").textContent = roleLabels[state.identity?.role] || "";
  mount($("userMenuHeader"), html`<span class="avatar large" aria-hidden="true">${initials(name)}</span><div><b>${name}</b><span class="muted">@${user?.username || ""} · ${roleLabels[state.identity?.role] || ""}</span></div>`);
  $("brandVersion").textContent = state.health?.version ? "v" + state.health.version : "";
}

function renderNav() {
  mount($("nav"), sections.map((section) => {
    const items = section.views.map((id) => byId[id]).filter(isVisible);
    if (!items.length) return "";
    return html`<div class="nav-section"><p class="nav-label" id="nav-${section.id}">${section.label}</p>
      <ul aria-labelledby="nav-${section.id}">${items.map((view) => html`<li><a href="#/${view.id}" data-view="${view.id}">${icon(view.icon)}<span>${view.label}</span></a></li>`)}</ul></div>`;
  }));
}

function renderServerStatus() {
  const h = state.health;
  mount($("serverStatus"), h
    ? html`<span class="status-dot ok" aria-hidden="true"></span><div><b>Servidor en línea</b><span>${h.publicUrl || location.host} · firmas ${h.signaturePolicy}</span></div>`
    : html`<span class="status-dot warn" aria-hidden="true"></span><div><b>Estado desconocido</b><span>No se pudo leer /health</span></div>`);
}

function toggleMenu(open) {
  document.body.classList.toggle("menu-open", open);
  $("menuToggle").setAttribute("aria-expanded", String(open));
  if (open) $("nav").querySelector("a")?.focus();
}
$("menuToggle").addEventListener("click", () => toggleMenu(true));
document.querySelectorAll("[data-close-menu]").forEach((element) => element.addEventListener("click", () => {
  toggleMenu(false);
  $("menuToggle").focus();
}));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("menu-open")) toggleMenu(false);
});

// User menu (button + role=menu, arrow-key navigation, Escape to close).
const userButton = $("userButton"), userMenu = $("userMenu");
function setUserMenu(open) {
  userMenu.hidden = !open;
  userButton.setAttribute("aria-expanded", String(open));
  if (open) userMenu.querySelector("[role=menuitem]").focus();
}
userButton.addEventListener("click", () => setUserMenu(userMenu.hidden));
document.addEventListener("click", (event) => {
  if (!userMenu.hidden && !event.target.closest(".user-menu")) setUserMenu(false);
});
userMenu.addEventListener("keydown", (event) => {
  const items = [...userMenu.querySelectorAll("[role=menuitem]")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "Escape") { setUserMenu(false); userButton.focus(); }
  if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length].focus(); }
  if (event.key === "ArrowUp") { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
  if (event.key === "Tab") setUserMenu(false);
});
userMenu.addEventListener("click", async (event) => {
  const item = event.target.closest("[data-menu]");
  if (!item) return;
  setUserMenu(false);
  if (item.dataset.menu === "password") openChangePassword();
  if (item.dataset.menu === "connect") navigate("connect");
  if (item.dataset.menu === "keys") navigate("my-keys");
  if (item.dataset.menu === "logout") logout();
});

async function logout() {
  try {
    await post("/auth/logout");
  } catch (error) {
    toastError(error);
  }
  state.identity = null;
  state.user = null;
  state.permissions = null;
  store.invalidate();
  history.replaceState(null, "", "#/dashboard");
  showLogin("Cerraste sesión correctamente.");
}

$("refreshButton").addEventListener("click", async () => {
  store.invalidate();
  await renderCurrent();
  toast("Datos actualizados", "info");
});

// ------------------------------------------------------------------ router

function parseHash() {
  const [path] = location.hash.replace(/^#\/?/, "").split("?");
  return path || null;
}

export function hashParams() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}

export async function navigate(id, { params, replace = false } = {}) {
  const view = isVisible(byId[id]) ? byId[id] : byId.dashboard;
  const query = params ? "?" + new URLSearchParams(params).toString() : "";
  const hash = "#/" + view.id + query;
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  await renderView(view);
}

async function renderCurrent() {
  if (current) await renderView(current, { keepFocus: true });
}

async function renderView(view, { keepFocus = false } = {}) {
  const token = ++renderToken;
  const changed = current !== view;
  current = view;
  toggleMenu(false);
  document.querySelectorAll("#nav a[data-view]").forEach((link) => {
    const active = link.dataset.view === view.id;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const section = sections.find((item) => item.views.includes(view.id));
  $("crumbSection").textContent = section?.label || "";
  $("crumbPage").textContent = view.label;
  $("pageTitle").textContent = view.title;
  $("pageSubtitle").textContent = view.subtitle;
  document.title = view.label + " · MODAI";
  // Fresh containers per render so listeners never accumulate.
  const actions = document.createElement("div");
  actions.className = "page-actions-inner";
  $("pageActions").replaceChildren(actions);
  const root = document.createElement("section");
  root.className = "view view-" + view.id;
  root.setAttribute("aria-labelledby", "pageTitle");
  $("viewRoot").replaceChildren(root);
  if (changed && !keepFocus) {
    window.scrollTo({ top: 0 });
    $("main").focus({ preventScroll: true });
  }
  try {
    await view.render(root, { actions, params: hashParams(), navigate, isCurrent: () => token === renderToken });
  } catch (error) {
    if (token !== renderToken) return;
    mount(root, html`<div class="panel"><div class="empty-state error"><span class="empty-icon">${icon("alert", 26)}</span><h3>No se pudo mostrar esta sección</h3><p>${error.message}</p></div></div>`);
  }
}

window.addEventListener("popstate", () => {
  if ($("appShell").hidden) return;
  const id = parseHash();
  if (id && isVisible(byId[id])) renderView(byId[id]);
});
// Plain anchors (#/view) are handled here to keep history consistent.
document.addEventListener("click", (event) => {
  const link = event.target.closest('a[href^="#/"]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || $("appShell").hidden) return;
  event.preventDefault();
  const [path, query] = link.getAttribute("href").slice(2).split("?");
  navigate(path, { params: query ? Object.fromEntries(new URLSearchParams(query)) : undefined });
});

boot();
