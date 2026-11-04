import { html } from "../lib/html.js";

export const roleLabels = {
  admin: "Administración global",
  "org-admin": "Administración de organización",
  publisher: "Publicación",
  worker: "Worker",
  reader: "Lectura",
};
export const roleDescriptions = {
  reader: "Consulta catálogo, conocimiento y la memoria de sus proyectos.",
  publisher: "Además publica paquetes y conocimiento, crea proyectos, guarda memoria y envía tareas.",
  worker: "Pensado para workers: reclama y completa ejecuciones de sus proyectos.",
  "org-admin":
    "Gestiona usuarios, API keys, proyectos y namespaces de sus organizaciones, y publica en sus namespaces.",
  admin: "Control total: todas las organizaciones, auditoría, backups y retención.",
};

const statusTone = {
  active: "success",
  completed: "success",
  deprecated: "warning",
  queued: "neutral",
  running: "info",
  yanked: "danger",
  failed: "danger",
  cancelled: "neutral",
};
const statusLabels = {
  active: "Activa",
  deprecated: "Deprecada",
  yanked: "Retirada",
  queued: "En cola",
  running: "En curso",
  completed: "Completada",
  failed: "Fallida",
  cancelled: "Cancelada",
};

export function initials(name) {
  return (
    String(name || "?")
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "?"
  );
}

export function roleBadge(role) {
  return html`<span class="badge role-${role}">${roleLabels[role] || role}</span>`;
}

export function statusBadge(status) {
  return html`<span class="badge tone-${statusTone[status] || "neutral"}"><span class="dot" aria-hidden="true"></span>${statusLabels[status] || status}</span>`;
}
