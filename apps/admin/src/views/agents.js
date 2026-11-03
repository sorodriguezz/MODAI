// Agents are packages that contribute spec.contributes.agents; they are listed in Paquetes (type Agentes) and
// their detail opens from there. This module holds that detail: activate, inspect and send a task to a worker.

import { post } from "../lib/api.js";
import { delegate, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { bindForm, closeDialog, codeBlock, openDialog, setBusy, toast, toastError } from "../lib/ui.js";
import { can, describeManifest } from "../state.js";

/** One entry per agent contributed by a package (spec.contributes.agents). */
export function collectAgents(packages) {
  const agents = [];
  for (const item of packages) {
    const info = describeManifest(item);
    for (const agent of info.agents)
      agents.push({ item, info, agent, key: item.name + "@" + item.version + "#" + (agent.name || item.name) });
  }
  return agents.sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/** Agent detail: activation command, what it carries and, for a project, its composition and a task for a worker. */
export function openAgent(entry, projects, navigate) {
  const { item, agent } = entry;
  const memory = agent.memory || { read: ["project"], write: false };
  const body = openDialog({
    title: agent.name || item.name,
    description: item.name + "@" + item.version,
    size: "lg",
    body: html`
      <p class="lead">${item.description}</p>
      ${codeBlock("activateCommand", "modai agent activate " + item.name + "@" + item.version, "Copiar")}
      <dl class="definition-grid">
        <div><dt>Memoria (lectura)</dt><dd>${(memory.read || ["project"]).join(", ")}</dd></div>
        <div><dt>Memoria (escritura)</dt><dd>${memory.write ? "Permitida" : "Deshabilitada"}</dd></div>
        ${agent.runtime ? html`<div><dt>Runtime sugerido</dt><dd>${agent.runtime.provider}${agent.runtime.model ? " · " + agent.runtime.model : ""}</dd></div>` : ""}
      </dl>
      <h4>Capacidades</h4>
      ${(agent.capabilities || []).length ? html`<ul class="chip-list">${agent.capabilities.map((capability) => html`<li class="chip"><code>${capability}</code></li>`)}</ul>` : html`<p class="muted small">Sin herramientas declaradas.</p>`}
      <h4>Skills</h4>
      ${(agent.skills || []).length ? html`<ul class="chip-list">${agent.skills.map((skill) => html`<li class="chip"><code>${skill}</code></li>`)}</ul>` : html`<p class="muted small">Sin skills declaradas.</p>`}
      <details class="disclosure"><summary>Instrucciones del agente</summary><pre class="pre-wrap">${agent.instructions || "Sin instrucciones."}</pre></details>
      <hr>
      <h4>Probar en un proyecto</h4>
      ${
        projects.length
          ? html`
        <div class="field"><label for="agentProject">Proyecto</label><select id="agentProject" required><option value="">Selecciona un proyecto</option>${projects.map((project) => html`<option value="${project.id}">${project.name}</option>`)}</select></div>
        <div class="row-actions"><button type="button" class="btn" data-action="compose">${icon("layers")}Ver composición</button></div>
        <div id="composition"></div>
        ${
          can.submitRuns()
            ? html`<form id="taskForm" class="stack" novalidate>
          <div class="field"><label for="agentTask">Tarea para el worker del proyecto</label><textarea id="agentTask" rows="4" required maxlength="50000" placeholder="Describe qué debe hacer el agente…"></textarea><p class="hint">La tarea queda en cola hasta que un worker autorizado la reclame.</p></div>
          <div class="form-error" role="alert" hidden></div>
          <div class="dialog-actions"><button type="submit" class="btn primary">${icon("play")}Enviar tarea</button></div>
        </form>`
            : html`<p class="hint">Tu rol no permite enviar tareas; solicita el rol de publicación.</p>`
        }`
          : html`<p class="muted">No tienes proyectos disponibles. Crea uno en <a href="#/projects">Proyectos</a>.</p>`
      }`,
  });
  const projectSelect = body.querySelector("#agentProject");
  delegate(body, {
    compose: async (button) => {
      if (!projectSelect.value) return (projectSelect.focus(), toastError(new Error("Selecciona un proyecto.")));
      setBusy(button, true);
      try {
        const { bundle } = await post("/agents/compose", {
          projectId: projectSelect.value,
          name: item.name,
          range: item.version,
        });
        mount(
          body.querySelector("#composition"),
          html`<div class="composition">
          <dl class="definition-grid">
            <div><dt>Paquetes</dt><dd>${(bundle.packages || []).map((p) => p.name + "@" + p.version).join(", ") || "—"}</dd></div>
            <div><dt>Capacidades</dt><dd>${(bundle.capabilities || []).map((c) => c.name).join(", ") || "—"}</dd></div>
            <div><dt>Permisos</dt><dd>${(bundle.permissions || []).join(", ") || "Ninguno"}</dd></div>
            <div><dt>Digest</dt><dd><code>${String(bundle.digest || "").slice(0, 24)}…</code></dd></div>
          </dl></div>`,
        );
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
