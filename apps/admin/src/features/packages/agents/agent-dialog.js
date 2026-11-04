import { can } from "../../../app/state.js";
import { post } from "../../../shared/lib/api.js";
import { delegate, html, mount } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { describeManifest } from "../../../shared/lib/manifest.js";
import { codeBlock } from "../../../shared/ui/code-block.js";
import { closeDialog, openDialog } from "../../../shared/ui/dialog.js";
import { bindForm, setBusy } from "../../../shared/ui/form.js";
import { toast, toastError } from "../../../shared/ui/toast.js";

export function collectAgents(packages) {
  const agents = [];
  for (const item of packages) {
    const info = describeManifest(item);
    for (const agent of info.agents)
      agents.push({ item, info, agent, key: `${item.name}@${item.version}#${agent.name || item.name}` });
  }
  return agents.sort((a, b) => a.item.name.localeCompare(b.item.name));
}

function chips(values, emptyText) {
  return (values || []).length
    ? html`<ul class="chip-list">${values.map((value) => html`<li class="chip"><code>${value}</code></li>`)}</ul>`
    : html`<p class="muted small">${emptyText}</p>`;
}

function runtimeRow(runtime) {
  if (!runtime) return "";
  return html`<div><dt>Runtime sugerido</dt><dd>${runtime.provider}${runtime.model ? ` · ${runtime.model}` : ""}</dd></div>`;
}

function taskForm() {
  if (!can.submitRuns())
    return html`<p class="hint">Tu rol no permite enviar tareas; solicita el rol de publicación.</p>`;
  return html`<form id="taskForm" class="stack" novalidate>
          <div class="field"><label for="agentTask">Tarea para el worker del proyecto</label><textarea id="agentTask" rows="4" required maxlength="50000" placeholder="Describe qué debe hacer el agente…"></textarea><p class="hint">La tarea queda en cola hasta que un worker autorizado la reclame.</p></div>
          <div class="form-error" role="alert" hidden></div>
          <div class="dialog-actions"><button type="submit" class="btn primary">${icon("play")}Enviar tarea</button></div>
        </form>`;
}

function projectSection(projects) {
  if (!projects.length)
    return html`<p class="muted">No tienes proyectos disponibles. Crea uno en <a href="#/projects">Proyectos</a>.</p>`;
  return html`
        <div class="field"><label for="agentProject">Proyecto</label><select id="agentProject" required><option value="">Selecciona un proyecto</option>${projects.map((project) => html`<option value="${project.id}">${project.name}</option>`)}</select></div>
        <div class="row-actions"><button type="button" class="btn" data-action="compose">${icon("layers")}Ver composición</button></div>
        <div id="composition"></div>
        ${taskForm()}`;
}

function agentBody(item, agent, projects) {
  const memory = agent.memory || { read: ["project"], write: false };
  return html`
      <p class="lead">${item.description}</p>
      ${codeBlock("activateCommand", `modai agent activate ${item.name}@${item.version}`, "Copiar")}
      <dl class="definition-grid">
        <div><dt>Memoria (lectura)</dt><dd>${(memory.read || ["project"]).join(", ")}</dd></div>
        <div><dt>Memoria (escritura)</dt><dd>${memory.write ? "Permitida" : "Deshabilitada"}</dd></div>
        ${runtimeRow(agent.runtime)}
      </dl>
      <h4>Capacidades</h4>
      ${chips(agent.capabilities, "Sin herramientas declaradas.")}
      <h4>Skills</h4>
      ${chips(agent.skills, "Sin skills declaradas.")}
      <details class="disclosure"><summary>Instrucciones del agente</summary><pre class="pre-wrap">${agent.instructions || "Sin instrucciones."}</pre></details>
      <hr>
      <h4>Probar en un proyecto</h4>
      ${projectSection(projects)}`;
}

function compositionMarkup(bundle) {
  return html`<div class="composition">
          <dl class="definition-grid">
            <div><dt>Paquetes</dt><dd>${(bundle.packages || []).map((p) => `${p.name}@${p.version}`).join(", ") || "—"}</dd></div>
            <div><dt>Capacidades</dt><dd>${(bundle.capabilities || []).map((c) => c.name).join(", ") || "—"}</dd></div>
            <div><dt>Permisos</dt><dd>${(bundle.permissions || []).join(", ") || "Ninguno"}</dd></div>
            <div><dt>Digest</dt><dd><code>${String(bundle.digest || "").slice(0, 24)}…</code></dd></div>
          </dl></div>`;
}

export function openAgent(entry, projects, navigate) {
  const { item, agent } = entry;
  const body = openDialog({
    title: agent.name || item.name,
    description: `${item.name}@${item.version}`,
    size: "lg",
    body: agentBody(item, agent, projects),
  });
  const projectSelect = body.querySelector("#agentProject");
  delegate(body, {
    compose: async (button) => {
      if (!projectSelect.value) {
        projectSelect.focus();
        return toastError(new Error("Selecciona un proyecto."));
      }
      setBusy(button, true);
      try {
        const { bundle } = await post("/agents/compose", {
          projectId: projectSelect.value,
          name: item.name,
          range: item.version,
        });
        mount(body.querySelector("#composition"), compositionMarkup(bundle));
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(button, false);
      }
    },
  });
  const form = body.querySelector("#taskForm");
  if (form)
    bindForm(form, async () => {
      if (!projectSelect.value) throw new Error("Selecciona un proyecto.");
      await post("/runs", {
        projectId: projectSelect.value,
        name: item.name,
        range: item.version,
        task: form.agentTask.value,
      });
      const projectId = projectSelect.value;
      closeDialog();
      toast("Tarea en cola. Un worker autorizado la ejecutará.");
      navigate("runs", { params: { projectId } });
    });
}
