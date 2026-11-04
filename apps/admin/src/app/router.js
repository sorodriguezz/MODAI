import { accessView } from "../features/admin/access/access-view.js";
import { auditView } from "../features/admin/audit/audit-view.js";
import { categoriesView } from "../features/admin/categories/categories-view.js";
import { namespacesView } from "../features/admin/namespaces/namespaces-view.js";
import { organizationsView } from "../features/admin/organizations/organizations-view.js";
import { usersView } from "../features/admin/users/users-view.js";
import { connectView } from "../features/connect/connect-view.js";
import { dashboardView } from "../features/dashboard/dashboard-view.js";
import { myKeysView } from "../features/keys/my-keys-view.js";
import { knowledgeView } from "../features/knowledge/knowledge-view.js";
import { memoriesView } from "../features/memories/memories-view.js";
import { packagesView } from "../features/packages/catalog/packages-view.js";
import { projectsView } from "../features/projects/projects-view.js";
import { runsView } from "../features/runs/runs-view.js";
import { $, html, mount } from "../shared/lib/html.js";
import { icon } from "../shared/lib/icons.js";
import { toggleMenu } from "./sidebar.js";

const views = [
  dashboardView,
  packagesView,
  knowledgeView,
  projectsView,
  memoriesView,
  runsView,
  connectView,
  myKeysView,
  organizationsView,
  namespacesView,
  categoriesView,
  usersView,
  accessView,
  auditView,
];
export const sections = [
  { id: "library", label: "Biblioteca", views: ["dashboard", "packages"] },
  { id: "work", label: "Proyectos", views: ["projects", "runs", "memories", "knowledge", "connect", "my-keys"] },
  {
    id: "admin",
    label: "Administración",
    views: ["organizations", "namespaces", "categories", "users", "access", "audit"],
  },
];
// why: agents and templates were menus before becoming type tabs of Paquetes; old links still land there.
export const MOVED = { agents: { type: "agents" }, templates: { type: "templates" } };
export const byId = Object.fromEntries(views.map((view) => [view.id, view]));
let current = null;
let renderToken = 0;

export function isVisible(view) {
  return Boolean(view) && (!view.visible || view.visible());
}

export function parseHash() {
  const [path] = location.hash.replace(/^#\/?/, "").split("?");
  return path || null;
}

export function hashParams() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}

export async function navigate(id, { params, replace = false } = {}) {
  if (MOVED[id]) {
    params = { ...MOVED[id], ...params };
    id = "packages";
    replace = true;
  }
  const view = isVisible(byId[id]) ? byId[id] : byId.dashboard;
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const hash = `#/${view.id}${query}`;
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  await renderView(view);
}

export async function renderCurrent() {
  if (current) await renderView(current, { keepFocus: true });
}

function markActive(view) {
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
  document.title = `${view.label} · MODAI`;
}

function freshContainers(view) {
  const actions = document.createElement("div");
  actions.className = "page-actions-inner";
  $("pageActions").replaceChildren(actions);
  const root = document.createElement("section");
  root.className = `view view-${view.id}`;
  root.setAttribute("aria-labelledby", "pageTitle");
  $("viewRoot").replaceChildren(root);
  return { actions, root };
}

async function renderView(view, { keepFocus = false } = {}) {
  const token = ++renderToken;
  const changed = current !== view;
  current = view;
  toggleMenu(false);
  markActive(view);
  const { actions, root } = freshContainers(view);
  if (changed && !keepFocus) {
    window.scrollTo({ top: 0 });
    $("main").focus({ preventScroll: true });
  }
  try {
    await view.render(root, { actions, params: hashParams(), navigate, isCurrent: () => token === renderToken });
  } catch (error) {
    if (token !== renderToken) return;
    mount(
      root,
      html`<div class="panel"><div class="empty-state error"><span class="empty-icon">${icon("alert", 26)}</span><h3>No se pudo mostrar esta sección</h3><p>${error.message}</p></div></div>`,
    );
  }
}

export function initRouter() {
  window.addEventListener("popstate", () => {
    if ($("appShell").hidden) return;
    const id = parseHash();
    if (MOVED[id]) navigate(id, { params: Object.fromEntries(hashParams()) });
    else if (id && isVisible(byId[id])) renderView(byId[id]);
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#/"]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || $("appShell").hidden) return;
    event.preventDefault();
    const [path, query] = link.getAttribute("href").slice(2).split("?");
    navigate(path, { params: query ? Object.fromEntries(new URLSearchParams(query)) : undefined });
  });
}
