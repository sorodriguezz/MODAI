import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get, post } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, confirmDialog, toast, skeletonRows, emptyState, errorState, timeTag, statusBadge, formatDate } from "../lib/ui.js";
import { store, can } from "../state.js";

let lastProject = "";

function runDetail(run, onChange) {
  const cancellable = ["queued", "running"].includes(run.status) && can.submitRuns();
  const body = openDialog({
    title: run.agentName + "@" + run.agentVersion,
    description: "Ejecución " + run.id,
    size: "lg",
    body: html`
      <dl class="definition-grid">
        <div><dt>Estado</dt><dd>${statusBadge(run.status)}</dd></div>
        <div><dt>Intentos</dt><dd>${run.attempts}</dd></div>
        <div><dt>Creada</dt><dd>${formatDate(run.createdAt)}</dd></div>
        <div><dt>Actualizada</dt><dd>${formatDate(run.updatedAt)}</dd></div>
        ${run.leaseExpiresAt ? html`<div><dt>Asignación vence</dt><dd>${formatDate(run.leaseExpiresAt)}</dd></div>` : ""}
        <div><dt>Definición (digest)</dt><dd><code>${String(run.bundle?.digest || "").slice(0, 24)}…</code></dd></div>
      </dl>
      <h4>Tarea</h4><pre class="pre-wrap">${run.task}</pre>
      <h4>${run.error ? "Error" : "Resultado"}</h4>
      <pre class="pre-wrap ${run.error ? "text-danger" : ""}">${run.result || run.error || "Esperando a que un worker la ejecute…"}</pre>
      ${cancellable ? html`<div class="dialog-actions"><button type="button" class="btn danger" data-action="cancel">${icon("ban")}Cancelar tarea</button></div>` : ""}`,
  });
  delegate(body, {
    cancel: () => confirmDialog({
      title: "Cancelar tarea",
      message: "El worker perderá la asignación y la tarea no se ejecutará.",
      confirmLabel: "Cancelar tarea",
      action: () => post("/runs/" + encodeURIComponent(run.id) + "/cancel", {}),
    }).then(async (ok) => {
      if (!ok) return;
      toast("Tarea cancelada");
      await onChange();
    }),
  });
}

async function newRun(project, onCreated) {
  const agents = await store.agents();
  const body = openDialog({
    title: "Nueva tarea",
    description: "Proyecto " + project.name,
    size: "md",
    body: agents.length
      ? html`<form class="stack" novalidate>
        <div class="field"><label for="runAgent">Agente</label><select id="runAgent" required>${agents.map((item) => html`<option value="${item.name}@${item.version}">${item.name}@${item.version}</option>`)}</select></div>
        <div class="field"><label for="runTask">Tarea</label><textarea id="runTask" rows="6" required maxlength="50000" placeholder="Describe qué debe hacer el agente…"></textarea></div>
        <div class="form-error" role="alert" hidden></div>
        <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${icon("play")}Enviar a la cola</button></div>
      </form>`
      : emptyState({ iconName: "bot", title: "No hay agentes publicados", text: "Publica un agente antes de enviar tareas." }),
  });
  const form = body.querySelector("form");
  if (!form) return;
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const spec = form.runAgent.value, at = spec.lastIndexOf("@");
    await post("/runs", { projectId: project.id, name: spec.slice(0, at), range: spec.slice(at + 1), task: form.runTask.value });
    closeDialog();
    toast("Tarea en cola");
    await onCreated();
  });
}

export default {
  id: "runs",
  label: "Ejecuciones",
  icon: "play",
  title: "Ejecuciones",
  subtitle: "Tareas enviadas a los workers de cada proyecto y sus resultados.",
  async render(root, { actions, params, isCurrent }) {
    mount(root, html`
      <div class="toolbar">
        <label class="sr-only" for="runProject">Proyecto</label><select id="runProject" class="grow"><option value="">Cargando proyectos…</option></select>
        <label class="sr-only" for="runStatus">Estado</label><select id="runStatus"><option value="">Todos los estados</option><option value="queued">En cola</option><option value="running">En curso</option><option value="completed">Completadas</option><option value="failed">Fallidas</option><option value="cancelled">Canceladas</option></select>
      </div>
      <div class="callout tone-info">${icon("info")}<span>El servidor no ejecuta modelos: un worker del proyecto (<code>modai agent worker</code>) reclama cada tarea. Se muestran las 50 más recientes.</span></div>
      <div class="panel" id="runResults"></div>`);
    const $project = root.querySelector("#runProject"), $status = root.querySelector("#runStatus");
    let projects = [], runs = [];
    const project = () => projects.find((p) => p.id === $project.value);
    const draw = () => {
      const list = runs.filter((run) => !$status.value || run.status === $status.value);
      mount(root.querySelector("#runResults"), !project()
        ? emptyState({ iconName: "folder", title: "Elige un proyecto", text: "Las ejecuciones se organizan por proyecto." })
        : list.length
          ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Agente</th><th scope="col">Tarea</th><th scope="col">Estado</th><th scope="col" class="hide-sm">Intentos</th><th scope="col">Actualizada</th></tr></thead>
            <tbody>${list.map((run) => html`<tr>
              <td><button type="button" class="link-button" data-action="open" data-id="${run.id}">${run.agentName}</button><div class="muted small">v${run.agentVersion}</div></td>
              <td class="truncate" title="${run.task}">${run.task.slice(0, 120)}</td>
              <td>${statusBadge(run.status)}</td>
              <td class="hide-sm">${run.attempts}</td>
              <td>${timeTag(run.updatedAt)}</td></tr>`)}</tbody></table></div>`
          : emptyState({ iconName: "play", title: runs.length ? "Sin ejecuciones con ese estado" : "Este proyecto no tiene ejecuciones", text: can.submitRuns() ? "Envía una tarea desde aquí o desde la ficha de un agente." : "" }));
    };
    const loadRuns = async () => {
      mount(actions, project() && can.submitRuns() ? html`<button class="btn primary" data-action="new">${icon("plus")}Nueva tarea</button>` : "");
      if (!project()) return draw();
      lastProject = project().id;
      mount(root.querySelector("#runResults"), skeletonRows(4, 4));
      try {
        runs = (await get("/runs?projectId=" + encodeURIComponent(project().id))).runs;
      } catch (error) {
        runs = [];
        if (isCurrent()) mount(root.querySelector("#runResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    try {
      projects = await store.projects();
    } catch (error) {
      mount(root.querySelector("#runResults"), errorState(error));
      return;
    }
    if (!isCurrent()) return;
    mount($project, html`<option value="">Selecciona un proyecto</option>${projects.map((p) => html`<option value="${p.id}">${p.name} (${p.id})</option>`)}`);
    const wanted = params.get("projectId") || lastProject || (projects.length === 1 ? projects[0].id : "");
    $project.value = projects.some((p) => p.id === wanted) ? wanted : "";
    $project.addEventListener("change", loadRuns);
    $status.addEventListener("change", draw);
    const handlers = {
      open: (button) => {
        const run = runs.find((item) => item.id === button.dataset.id);
        if (run) runDetail(run, loadRuns);
      },
      new: () => project() && newRun(project(), loadRuns),
      retry: loadRuns,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await loadRuns();
  },
};
