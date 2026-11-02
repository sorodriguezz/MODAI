import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get, post } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, toast, toastError, skeletonRows, emptyState, errorState, formatDate, timeTag, debounce, setBusy } from "../lib/ui.js";
import { can } from "../state.js";
import { actionLabel } from "./dashboard.js";

const groups = { auth: "Sesiones", user: "Usuarios", "api-key": "API keys", package: "Paquetes", publisher: "Publicadores", knowledge: "Conocimiento", memory: "Memoria", project: "Proyectos", organization: "Organizaciones", run: "Ejecuciones", backup: "Backups", retention: "Retención" };

function pruneDialog() {
  const body = openDialog({
    title: "Depurar datos antiguos",
    description: "Elimina memorias y eventos de auditoría más antiguos que los días indicados.",
    size: "sm",
    body: html`<form class="stack" novalidate>
      <div class="field-row">
        <div class="field"><label for="pruneMemory">Memorias (días)</label><input id="pruneMemory" type="number" min="1" max="36500" value="365" required></div>
        <div class="field"><label for="pruneAudit">Auditoría (días)</label><input id="pruneAudit" type="number" min="1" max="36500" value="90" required></div>
      </div>
      <div class="callout tone-danger">${icon("alert")}<span>Los datos eliminados no se pueden recuperar. Exporta un backup antes.</span></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn danger">Depurar ahora</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const result = await post("/admin/prune", { memoryDays: Number(form.pruneMemory.value), auditDays: Number(form.pruneAudit.value) });
    closeDialog();
    toast(`Depuración completa: ${result.memories} memorias y ${result.audit} eventos eliminados`);
  });
}

async function exportBackup(button) {
  setBusy(button, true);
  try {
    const data = await get("/admin/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "modai-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Backup exportado");
  } catch (error) {
    toastError(error);
  } finally {
    setBusy(button, false);
  }
}

export default {
  id: "audit",
  label: "Auditoría",
  icon: "activity",
  title: "Auditoría",
  subtitle: "Cada acción relevante del servidor queda registrada con su autor.",
  visible: () => can.admin(),
  async render(root, { actions, isCurrent }) {
    mount(actions, html`<button class="btn" data-action="prune">${icon("trash")}Depurar</button><button class="btn primary" data-action="export">${icon("download")}Exportar backup</button>`);
    mount(root, html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="auditSearch">Filtrar eventos</label><input id="auditSearch" type="search" placeholder="Filtrar por autor, acción o recurso…"></div>
        <label class="sr-only" for="auditGroup">Categoría</label><select id="auditGroup"><option value="">Todas las categorías</option>${Object.entries(groups).map(([value, label]) => html`<option value="${value}">${label}</option>`)}</select>
        <label class="sr-only" for="auditLimit">Cantidad</label><select id="auditLimit"><option value="100">Últimos 100</option><option value="500">Últimos 500</option><option value="1000">Últimos 1000</option></select>
      </div>
      <p class="results-meta" id="auditMeta" aria-live="polite"></p>
      <div class="panel" id="auditResults">${skeletonRows(8, 4)}</div>`);
    let events = [];
    const draw = () => {
      const q = root.querySelector("#auditSearch").value.trim().toLocaleLowerCase(), group = root.querySelector("#auditGroup").value;
      const list = events.filter((e) => (!group || e.action.split(".")[0] === group) && (!q || [e.actor, e.action, actionLabel(e.action), e.resource].join(" ").toLocaleLowerCase().includes(q)));
      root.querySelector("#auditMeta").textContent = list.length + " de " + events.length + " eventos";
      mount(root.querySelector("#auditResults"), list.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Cuándo</th><th scope="col">Acción</th><th scope="col">Autor</th><th scope="col" class="hide-sm">Recurso</th><th scope="col"><span class="sr-only">Detalles</span></th></tr></thead>
          <tbody>${list.map((e) => html`<tr>
            <td><span title="${formatDate(e.createdAt)}">${timeTag(e.createdAt)}</span></td>
            <td><span class="badge ${e.action.endsWith("failed") ? "tone-danger" : e.action.includes("delete") || e.action.includes("revoke") || e.action.includes("yank") ? "tone-warning" : ""}">${actionLabel(e.action)}</span><div class="muted small"><code>${e.action}</code></div></td>
            <td>${e.actor}</td>
            <td class="hide-sm truncate" title="${e.resource}">${e.resource}</td>
            <td>${e.details && Object.keys(e.details).length ? html`<button type="button" class="btn small ghost" data-action="details" data-id="${e.id}">Ver</button>` : ""}</td></tr>`)}</tbody></table></div>`
        : emptyState({ iconName: "activity", title: events.length ? "Sin coincidencias" : "Sin actividad registrada" }));
    };
    const load = async () => {
      mount(root.querySelector("#auditResults"), skeletonRows(8, 4));
      try {
        events = (await get("/admin/audit?limit=" + root.querySelector("#auditLimit").value)).events;
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#auditResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#auditSearch").addEventListener("input", debounce(draw));
    root.querySelector("#auditGroup").addEventListener("change", draw);
    root.querySelector("#auditLimit").addEventListener("change", load);
    const handlers = {
      details: (button) => {
        const event = events.find((e) => e.id === button.dataset.id);
        if (event) openDialog({ title: actionLabel(event.action), description: formatDate(event.createdAt) + " · " + event.actor, size: "md", body: html`<dl class="definition-grid single"><div><dt>Recurso</dt><dd><code>${event.resource}</code></dd></div></dl><pre>${JSON.stringify(event.details, null, 2)}</pre>` });
      },
      export: exportBackup,
      prune: pruneDialog,
      retry: load,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
