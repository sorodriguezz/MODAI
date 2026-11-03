import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get } from "../lib/api.js";
import { timeTag, skeletonRows, roleLabels, emptyState } from "../lib/ui.js";
import { state, store, can } from "../state.js";

const MEMORY_PROJECT_SAMPLE = 12;

function stat({ label, value, hint, iconName, href }) {
  const body = html`<span class="stat-icon">${icon(iconName, 20)}</span><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><span class="stat-hint">${hint}</span>`;
  return href ? html`<a class="stat-card" href="${href}">${body}</a>` : html`<div class="stat-card">${body}</div>`;
}

async function memoryCount(projects) {
  const sample = projects.slice(0, MEMORY_PROJECT_SAMPLE);
  const counts = await Promise.all(sample.map((project) => get("/memories?projectId=" + encodeURIComponent(project.id) + "&limit=200").then((r) => r.memories.length).catch(() => 0)));
  const total = counts.reduce((sum, n) => sum + n, 0);
  const capped = counts.some((n) => n >= 200) || projects.length > sample.length;
  return { total, capped };
}

const actionLabels = {
  "auth.login": "Inicio de sesión", "auth.login-failed": "Intento fallido", "auth.logout": "Cierre de sesión", "auth.setup": "Instalación", "auth.setup-failed": "Instalación rechazada", "auth.password-change": "Cambio de contraseña",
  "user.create": "Usuario creado", "user.update": "Usuario modificado", "user.delete": "Usuario eliminado", "user.seed": "Admin inicial",
  "package.publish": "Paquete publicado", "package.deprecate": "Versión deprecada", "package.yank": "Versión retirada", "package.delete": "Versión eliminada",
  "publisher.register": "Publicador registrado", "publisher.trust": "Confianza de publicador", "organization.create": "Organización creada", "backup.export": "Backup exportado", "backup.import": "Backup importado", "retention.prune": "Depuración", "knowledge.vector-upload": "Vector indexado",
  "api-key.create": "API key creada", "api-key.revoke": "API key revocada", "api-key.grants": "Permisos de API key",
  "knowledge.create": "Documento creado", "knowledge.update": "Documento editado", "knowledge.delete": "Documento eliminado",
  "memory.create": "Memoria guardada", "memory.update": "Memoria editada", "memory.delete": "Memoria eliminada",
  "project.create": "Proyecto creado", "run.submit": "Tarea enviada", "run.finish": "Tarea finalizada", "run.cancel": "Tarea cancelada", "run.claim": "Tarea asignada",
};
export const actionLabel = (action) => actionLabels[action] || action;

export default {
  id: "dashboard",
  label: "Resumen",
  icon: "home",
  title: "Resumen",
  subtitle: "Estado del servidor y de tu biblioteca de capacidades.",
  async render(root, { actions, navigate, isCurrent }) {
    const name = state.user?.displayName || state.user?.username || "";
    mount(actions, html`${can.manageUsers() ? html`<a class="btn" href="#/users">${icon("users")}Invitar usuario</a>` : ""}<a class="btn primary" href="#/connect">${icon("terminal")}Conectar un cliente</a>`);
    mount(root, html`
      <div class="welcome"><div><h2>Hola, ${name}</h2><p>Tu rol es <b>${roleLabels[state.identity.role]}</b>. ${can.admin() ? "Tienes acceso completo al servidor." : can.manage() ? "Administras: " + can.managedOrganizations().map((o) => o.name).join(", ") + "." : "Algunas acciones dependen de los permisos que te asigne la administración."}</p></div></div>
      <div class="stat-grid" id="stats">${Array.from({ length: 5 }, () => html`<div class="stat-card"><span class="skeleton" style="width:36px;height:36px;border-radius:10px"></span><span class="skeleton" style="width:50%"></span><span class="skeleton" style="width:30%;height:26px"></span></div>`)}</div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h3>Publicados recientemente</h3><a class="link" href="#/packages">Ver catálogo</a></div><div id="recentPackages">${skeletonRows(4, 3)}</div></div>
        ${can.admin()
          ? html`<div class="panel"><div class="panel-head"><h3>Actividad reciente</h3><a class="link" href="#/audit">Ver auditoría</a></div><div id="recentAudit">${skeletonRows(4, 3)}</div></div>`
          : html`<div class="panel"><div class="panel-head"><h3>Tu acceso</h3></div><div class="panel-body" id="accessSummary"></div></div>`}
      </div>
      <div class="panel"><div class="panel-head"><h3>Servidor</h3></div><div class="panel-body"><dl class="definition-grid" id="serverInfo"></dl></div></div>
    `);
    delegate(root, { retry: () => navigate("dashboard") });

    const h = state.health;
    mount(root.querySelector("#serverInfo"), h
      ? html`<div><dt>Estado</dt><dd><span class="badge tone-success"><span class="dot"></span>En línea</span></dd></div>
          <div><dt>Versión</dt><dd>${h.version} · API v${h.apiVersion}</dd></div>
          <div><dt>Runtime</dt><dd>${h.runtime}</dd></div>
          <div><dt>Política de firmas</dt><dd>${h.signaturePolicy}</dd></div>
          <div><dt>URL pública</dt><dd>${h.publicUrl || html`<span class="muted">No configurada (${location.origin})</span>`}</dd></div>
          <div><dt>Inferencia</dt><dd>En los clientes o workers; el servidor no ejecuta modelos</dd></div>`
      : html`<div><dt>Estado</dt><dd><span class="badge tone-warning">Sin datos de /health</span></dd></div>`);

    if (!can.admin()) {
      const identity = state.identity;
      mount(root.querySelector("#accessSummary"), html`<dl class="definition-grid single">
        <div><dt>Proyectos asignados</dt><dd>${identity.projectIds.length ? identity.projectIds.join(", ") : "Ninguno (más los que crees)"}</dd></div>
        <div><dt>Organizaciones</dt><dd>${state.permissions?.organizations.length ? state.permissions.organizations.map((o) => o.name + (o.manage ? " (administras)" : "")).join(", ") : "Ninguna"}</dd></div>
        <div><dt>Namespaces publicables</dt><dd>${state.permissions?.publish.namespaces.length ? state.permissions.publish.namespaces.join(", ") : "Ninguno"}</dd></div>
      </dl>`);
    }

    const [summaryResult, projectsResult, documentsResult, usersResult] = await Promise.allSettled([
      store.summary(), store.projects(), store.documents(), can.manageUsers() ? get("/admin/users") : Promise.resolve(null),
    ]);
    if (!isCurrent()) return;
    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
    const projectList = projectsResult.status === "fulfilled" ? projectsResult.value : [];
    const memory = await memoryCount(projectList);
    if (!isCurrent()) return;
    mount(root.querySelector("#stats"), [
      stat({ label: "Paquetes", value: summary ? summary.packages : "—", hint: summary ? summary.versions + " versiones publicadas" : "No disponible", iconName: "package", href: "#/packages" }),
      stat({ label: "Agentes", value: summary ? summary.agents : "—", hint: "Listos para activar", iconName: "bot", href: "#/agents" }),
      stat({ label: "Conocimiento", value: documentsResult.status === "fulfilled" ? documentsResult.value.length : "—", hint: "Documentos compartidos", iconName: "book", href: "#/knowledge" }),
      stat({ label: "Proyectos", value: projectList.length, hint: can.admin() ? "En el servidor" : "Con acceso", iconName: "folder", href: "#/projects" }),
      stat({ label: "Memorias", value: memory.total + (memory.capped ? "+" : ""), hint: memory.capped ? `Muestra de ${Math.min(projectList.length, MEMORY_PROJECT_SAMPLE)} proyectos` : "En tus proyectos", iconName: "brain", href: "#/memories" }),
      usersResult.status === "fulfilled" && usersResult.value ? stat({ label: "Usuarios", value: usersResult.value.users.filter((u) => !u.disabledAt).length, hint: "Cuentas activas del panel", iconName: "users", href: "#/users" }) : "",
    ]);

    const recent = summary?.recent ?? [];
    mount(root.querySelector("#recentPackages"), recent.length
      ? html`<ul class="list">${recent.map((item) => html`<li><a href="#/packages?name=${encodeURIComponent(item.name)}"><span class="list-icon">${icon("package")}</span><span class="list-main"><b>${item.name}</b><span class="muted">v${item.version} · ${item.category}</span></span>${timeTag(item.publishedAt)}</a></li>`)}</ul>`
      : emptyState({ iconName: "package", title: "Aún no hay paquetes", text: "Publica el primero con modai package publish desde la CLI." }));

    if (can.admin()) {
      try {
        const { events } = await get("/admin/audit?limit=8");
        if (!isCurrent()) return;
        mount(root.querySelector("#recentAudit"), events.length
          ? html`<ul class="list">${events.map((event) => html`<li><div class="list-row"><span class="list-icon ${event.action.endsWith("failed") ? "danger" : ""}">${icon(event.action.startsWith("auth") ? "lock" : event.action.startsWith("user") ? "users" : "activity")}</span><span class="list-main"><b>${actionLabel(event.action)}</b><span class="muted">${event.actor} · ${event.resource}</span></span>${timeTag(event.createdAt)}</div></li>`)}</ul>`
          : emptyState({ iconName: "activity", title: "Sin actividad todavía" }));
      } catch (error) {
        mount(root.querySelector("#recentAudit"), html`<p class="panel-body muted">${error.message}</p>`);
      }
    }
  },
};
