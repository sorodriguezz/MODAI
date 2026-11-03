import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get, post } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, toast, toastError, skeletonRows, emptyState, errorState, formatDate, timeTag, debounce, setBusy } from "../lib/ui.js";
import { can } from "../state.js";
import { actionLabel } from "./dashboard.js";

const groups = { auth: "Sesiones", user: "Usuarios", "api-key": "API keys", package: "Paquetes", publisher: "Publicadores", knowledge: "Conocimiento", memory: "Memoria", project: "Proyectos", organization: "Organizaciones", run: "Ejecuciones", backup: "Backups", retention: "Retención" };

const retention = {
  audit: { field: "auditDays", result: "audit", title: "Depurar auditoría", noun: "eventos de auditoría", days: 90, help: "Elimina los eventos registrados hace más de los días indicados. Usa 0 para vaciar la auditoría completa." },
  memories: { field: "memoryDays", result: "memories", title: "Depurar memorias antiguas", noun: "memorias", days: 365, help: "Elimina, en todos los proyectos, las memorias que no se actualizan hace más de los días indicados. Usa 0 para eliminarlas todas." },
};

/** Retention for one target, with a live count of what will be deleted before confirming. */
export function pruneDialog(target, onDone) {
  const config = retention[target];
  const body = openDialog({
    title: config.title,
    description: config.help,
    size: "sm",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="pruneDays">Más antiguos que (días)</label><input id="pruneDays" type="number" min="0" max="36500" step="1" value="${config.days}" required></div>
      <p class="callout tone-info" id="prunePreview" aria-live="polite">${icon("info")}<span>Calculando…</span></p>
      <div class="callout tone-danger">${icon("alert")}<span>Lo eliminado no se puede recuperar. Exporta un backup antes si lo necesitas.</span></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn danger" disabled>Depurar</button></div>
    </form>`,
  });
  const form = body.querySelector("form"), submit = form.querySelector('button[type="submit"]'), preview = body.querySelector("#prunePreview span");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  let count = 0, sequence = 0;
  const refresh = debounce(async () => {
    const days = Number(form.pruneDays.value), mine = ++sequence;
    if (!form.pruneDays.checkValidity()) { preview.textContent = "Indica un número de días entre 0 y 36500."; submit.disabled = true; return; }
    try {
      const result = await post("/admin/prune", { [config.field]: days, dryRun: true });
      if (mine !== sequence) return;
      count = result[config.result];
      preview.textContent = count ? `Se eliminarán ${count} ${config.noun}.` : `No hay ${config.noun} con esa antigüedad: no se eliminará nada.`;
      submit.disabled = count === 0;
      submit.textContent = count ? `Eliminar ${count} ${config.noun}` : "Depurar";
    } catch (error) {
      preview.textContent = error.message;
    }
  }, 250);
  form.pruneDays.addEventListener("input", refresh);
  refresh();
  bindForm(form, async () => {
    const result = await post("/admin/prune", { [config.field]: Number(form.pruneDays.value) });
    closeDialog();
    toast(`Depuración completa: ${result[config.result]} ${config.noun} eliminados`);
    await onDone?.();
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
    mount(actions, html`<button class="btn" data-action="prune">${icon("trash")}Depurar auditoría</button><button class="btn primary" data-action="export">${icon("download")}Exportar backup</button>`);
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
      prune: () => pruneDialog("audit", load),
      retry: load,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
