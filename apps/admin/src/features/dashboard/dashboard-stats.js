import { can, store } from "../../app/state.js";
import { get } from "../../shared/lib/api.js";
import { html } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";

const MEMORY_PROJECT_SAMPLE = 12;

function stat({ label, value, hint, iconName, href }) {
  const body = html`<span class="stat-icon">${icon(iconName, 20)}</span><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><span class="stat-hint">${hint}</span>`;
  return href ? html`<a class="stat-card" href="${href}">${body}</a>` : html`<div class="stat-card">${body}</div>`;
}

async function memoryCount(projects) {
  const sample = projects.slice(0, MEMORY_PROJECT_SAMPLE);
  const counts = await Promise.all(
    sample.map((project) =>
      get(`/memories?projectId=${encodeURIComponent(project.id)}&limit=200`)
        .then((r) => r.memories.length)
        .catch(() => 0),
    ),
  );
  const total = counts.reduce((sum, n) => sum + n, 0);
  const capped = counts.some((n) => n >= 200) || projects.length > sample.length;
  return { total, capped };
}

const settled = (result, fallback) => (result.status === "fulfilled" ? result.value : fallback);

export const statSkeletons = () =>
  Array.from(
    { length: 5 },
    () =>
      html`<div class="stat-card"><span class="skeleton" style="width:36px;height:36px;border-radius:10px"></span><span class="skeleton" style="width:50%"></span><span class="skeleton" style="width:30%;height:26px"></span></div>`,
  );

export async function loadDashboardData() {
  const [summaryResult, projectsResult, documentsResult, usersResult] = await Promise.allSettled([
    store.summary(),
    store.projects(),
    store.documents(),
    can.manageUsers() ? get("/admin/users") : Promise.resolve(null),
  ]);
  return {
    summary: settled(summaryResult, null),
    projects: settled(projectsResult, []),
    documents: settled(documentsResult, null),
    users: settled(usersResult, null),
  };
}

function usersStat(users) {
  if (!users) return "";
  return stat({
    label: "Usuarios",
    value: users.users.filter((u) => !u.disabledAt).length,
    hint: "Cuentas activas del panel",
    iconName: "users",
    href: "#/users",
  });
}

function memoryStat(memory, projects) {
  return stat({
    label: "Memorias",
    value: memory.total + (memory.capped ? "+" : ""),
    hint: memory.capped
      ? `Muestra de ${Math.min(projects.length, MEMORY_PROJECT_SAMPLE)} proyectos`
      : "En tus proyectos",
    iconName: "brain",
    href: "#/memories",
  });
}

export async function dashboardStats({ summary, projects, documents, users }) {
  const memory = await memoryCount(projects);
  return [
    stat({
      label: "Paquetes",
      value: summary ? summary.packages : "—",
      hint: summary ? `${summary.versions} versiones publicadas` : "No disponible",
      iconName: "package",
      href: "#/packages",
    }),
    stat({
      label: "Agentes",
      value: summary ? summary.agents : "—",
      hint: "Listos para activar",
      iconName: "bot",
      href: "#/packages?type=agents",
    }),
    stat({
      label: "Conocimiento",
      value: documents ? documents.length : "—",
      hint: "Documentos compartidos",
      iconName: "book",
      href: "#/knowledge",
    }),
    stat({
      label: "Proyectos",
      value: projects.length,
      hint: can.admin() ? "En el servidor" : "Con acceso",
      iconName: "folder",
      href: "#/projects",
    }),
    memoryStat(memory, projects),
    usersStat(users),
  ];
}
