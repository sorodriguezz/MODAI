import { can, state } from "../../app/state.js";
import { get } from "../../shared/lib/api.js";
import { delegate, html, mount } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { roleLabels } from "../../shared/ui/labels.js";
import { skeletonRows } from "../../shared/ui/skeleton.js";
import { accessSummary, accessText, recentAudit, recentPackages, serverInfo, sidePanel } from "./dashboard-panels.js";
import { dashboardStats, loadDashboardData, statSkeletons } from "./dashboard-stats.js";

const layout = (name) => html`
      <div class="welcome"><div><h2>Hola, ${name}</h2><p>Tu rol es <b>${roleLabels[state.identity.role]}</b>. ${accessText()}</p></div></div>
      <div class="stat-grid" id="stats">${statSkeletons()}</div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>Publicados recientemente</h3><a class="link" href="#/packages">Ver catálogo</a></div><div id="recentPackages">${skeletonRows(4, 3)}</div></div>
        ${sidePanel()}
      </div>
      <div class="panel"><div class="panel-head"><h3>Servidor</h3></div><div class="panel-body"><dl class="definition-grid" id="serverInfo"></dl></div></div>
    `;

async function loadAudit(root, isCurrent) {
  try {
    const { events } = await get("/admin/audit?limit=8");
    if (!isCurrent()) return;
    mount(root.querySelector("#recentAudit"), recentAudit(events));
  } catch (error) {
    mount(root.querySelector("#recentAudit"), html`<p class="panel-body muted">${error.message}</p>`);
  }
}

export const dashboardView = {
  id: "dashboard",
  label: "Resumen",
  icon: "home",
  title: "Resumen",
  subtitle: "Estado del servidor y de tu biblioteca de capacidades.",
  async render(root, { actions, navigate, isCurrent }) {
    const name = state.user?.displayName || state.user?.username || "";
    mount(
      actions,
      html`${can.manageUsers() ? html`<a class="btn" href="#/users">${icon("users")}Invitar usuario</a>` : ""}<a class="btn primary" href="#/connect">${icon("terminal")}Conectar un cliente</a>`,
    );
    mount(root, layout(name));
    delegate(root, { retry: () => navigate("dashboard") });
    mount(root.querySelector("#serverInfo"), serverInfo(state.health));
    if (!can.admin()) mount(root.querySelector("#accessSummary"), accessSummary());
    const data = await loadDashboardData();
    if (!isCurrent()) return;
    const stats = await dashboardStats(data);
    if (!isCurrent()) return;
    mount(root.querySelector("#stats"), stats);
    mount(root.querySelector("#recentPackages"), recentPackages(data.summary?.recent ?? []));
    if (can.admin()) await loadAudit(root, isCurrent);
  },
};
