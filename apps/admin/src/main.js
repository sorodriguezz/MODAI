import {
  renderConnect,
  updateConnectionCommands,
  grantClient,
} from "./views/connect.js";
import { controller } from "./lib/controller.js";
import { $, toggleMenu } from "./lib/ui.js";
import { loadKeys } from "./views/access.js";
import { loadAudit } from "./views/audit.js";
import { loadRuns } from "./views/runs.js";
import { api } from "./lib/api.js";
import { renderPackages } from "./views/packages.js";
import { renderKnowledge } from "./views/knowledge.js";
import { renderAgents } from "./views/agents.js";
import { renderProjects } from "./views/projects.js";
import { loadMemories } from "./views/memories.js";
import { state } from "./state.js";
import { openConnection, disconnect, newKey } from "./views/access.js";
import { copyText } from "./lib/ui.js";
import { newMemory } from "./views/memories.js";
import { newProject } from "./views/projects.js";
import { editKnowledge } from "./views/knowledge.js";
import { downloadBackup } from "./views/audit.js";
let busy = false;
const titles = {
  agents: [
    "Agentes componibles",
    "Define una vez. Activa las capacidades que necesita cada proyecto.",
    "Agentes",
  ],
  projects: [
    "Tus proyectos conectados",
    "Identidades y acceso al contexto del servidor.",
    "Proyectos",
  ],
  runs: [
    "Ejecuciones de agentes",
    "Tareas, resultados y continuidad entre workers.",
    "Ejecuciones",
  ],
  packages: [
    "Tu biblioteca de capacidades",
    "Todo lo que tus agentes necesitan, en un solo lugar.",
    "Paquetes",
  ],
  knowledge: [
    "Conocimiento compartido",
    "Explora las guías de tus paquetes y añade lo que tu equipo aprende.",
    "Conocimiento",
  ],
  memories: [
    "Memoria de proyectos",
    "Decisiones y contexto que sobreviven a cada sesión.",
    "Memoria",
  ],
  keys: [
    "Controla quién tiene acceso",
    "Credenciales independientes para tus herramientas y agentes.",
    "Accesos y API keys",
  ],
  audit: [
    "Todo cambio deja una huella",
    "Consulta las acciones del servidor y conserva una copia de tus datos.",
    "Actividad",
  ],
  connect: [
    "Conecta tus agentes",
    "Un servidor ligero. Tus modelos, en tu equipo.",
    "Conectar un cliente",
  ],
};
$("themeSelect").value = window.modaiTheme.get();
$("themeSelect").addEventListener("change", (event) =>
  window.modaiTheme.set(event.target.value),
);
import { icon } from "./lib/icons.js";
document
  .querySelectorAll("[data-icon]")
  .forEach((e) => (e.innerHTML = icon(e.dataset.icon)));
export function navigate(view) {
  state.currentView = view;
  document
    .querySelectorAll(".view")
    .forEach((e) => e.classList.toggle("hidden", e.id !== "view-" + view));
  document
    .querySelectorAll("[data-view]")
    .forEach((e) => e.classList.toggle("active", e.dataset.view === view));
  $("pageTitle").textContent = titles[view][0];
  $("pageSubtitle").textContent = titles[view][1];
  $("breadcrumb").textContent = titles[view][2];
  toggleMenu(false);
  history.replaceState(null, "", "#" + view);
  if (view === "keys") loadKeys();
  if (view === "audit") loadAudit();
  if (view === "runs") loadRuns();
  if (view === "connect") renderConnect();
}
document
  .querySelectorAll("[data-view]")
  .forEach((e) => (e.onclick = () => navigate(e.dataset.view)));
export function permissions() {
  document
    .querySelectorAll("[data-admin]")
    .forEach((e) =>
      e.classList.toggle("hidden", state.session?.role !== "admin"),
    );
  document
    .querySelectorAll("[data-publisher]")
    .forEach((e) =>
      e.classList.toggle(
        "hidden",
        !["publisher", "admin"].includes(state.session?.role),
      ),
    );
}
export async function loadAll() {
  if (busy) return;
  busy = true;
  $("refresh").disabled = true;
  try {
    state.session = await api("/session");
    const [p, k, r] = await Promise.all([
      api("/packages?includeYanked=true"),
      api("/knowledge/documents?limit=500"),
      api("/projects"),
    ]);
    state.packages = p.packages;
    state.documents = k.documents;
    state.projectRecords = r.projects;
    $("connectionLabel").textContent =
      state.session.label + " · " + state.session.role;
    $("serverState").textContent = "Servidor conectado";
    $("statusDot").style.background = "#3fa880";
    $("connectionError").classList.add("hidden");
    $("statPackages").textContent = new Set(
      state.packages.filter((p) => p.status === "active").map((p) => p.name),
    ).size;
    $("statSkills").textContent = new Set(
      state.packages
        .filter((p) => p.type === "skill" && p.status === "active")
        .map((p) => p.name),
    ).size;
    $("statKnowledge").textContent = state.documents.length;
    $("navCount").textContent = new Set(state.packages.map((p) => p.name)).size;
    $("updatedAt").textContent =
      "Actualizado a las " +
      new Date().toLocaleTimeString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
      });
    permissions();
    renderPackages();
    renderKnowledge();
    renderAgents();
    renderProjects();
    renderConnect();
    if (state.currentView === "keys") await loadKeys();
    if (state.currentView === "audit") await loadAudit();
  } catch (e) {
    state.session = null;
    state.packages = [];
    state.documents = [];
    state.projectRecords = [];
    renderPackages();
    renderKnowledge();
    renderAgents();
    renderProjects();
    renderConnect();
    permissions();
    $("keyRows").innerHTML = "";
    $("auditRows").innerHTML = "";
    $("memoryList").innerHTML =
      '<div class="empty">Conecta al servidor para consultar la memoria.</div>';
    $("connectionLabel").textContent = "Sin conexión";
    $("serverState").textContent = "Acceso pendiente";
    $("statusDot").style.background = "#d18a59";
    $("connectionError").textContent = e.message;
    $("connectionError").classList.remove("hidden");
  } finally {
    busy = false;
    $("refresh").disabled = false;
  }
}
export async function refreshCurrent() {
  if (state.currentView === "memories") return loadMemories();
  if (state.currentView === "runs") return loadRuns();
  await loadAll();
}

const actions = {
  closeMenu: () => toggleMenu(false),
  openMenu: () => toggleMenu(true),
  openConnection,
  refresh: refreshCurrent,
  connect: () => navigate("connect"),
  renderPackages,
  newProject,
  updateConnectionCommands,
  grantClient,
  loadRuns,
  renderKnowledge,
  editKnowledge,
  loadMemories,
  newMemory,
  newKey,
  downloadBackup,
  closeModal: () => $("modal").close(),
  disconnect,
  copyCommands: () => copyText($("connectCommands").textContent),
};
for (const type of ["click", "input", "change", "submit"])
  document.addEventListener(type, (event) => {
    const element = event.target.closest("[data-" + type + "], [data-copy]");
    if (!element) return;
    if (type === "submit") event.preventDefault();
    if (type === "click" && element.dataset.copy)
      return void copyText($(element.dataset.copy).textContent);
    const action = actions[element.dataset[type]];
    if (action) action();
  });
Object.assign(controller, { refresh: loadAll, navigate });
navigate(
  Object.hasOwn(titles, location.hash.slice(1))
    ? location.hash.slice(1)
    : "packages",
);
fetch("/health")
  .then((response) => response.json())
  .then((health) => {
    state.publicUrl = health.publicUrl;
    if (health.publicUrl) $("connectServer").value = health.publicUrl;
    renderConnect();
  })
  .catch(() => {});
loadAll();
