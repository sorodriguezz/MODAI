import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, toast, skeletonCards, emptyState, errorState, codeBlock, debounce, setBusy, toastError } from "../lib/ui.js";
import { store, can, describeManifest, latestByName } from "../state.js";

/** One entry per agent: legacy packages of type agent and v1 packages contributing spec.contributes.agents. */
function collectAgents(packages) {
  const agents = [];
  for (const item of latestByName(packages)) {
    const info = describeManifest(item);
    for (const agent of info.agents) agents.push({ item, info, agent, key: item.name + "@" + item.version + "#" + (agent.name || item.name) });
  }
  return agents.sort((a, b) => a.item.name.localeCompare(b.item.name));
}

function agentCard({ item, info, agent, key }) {
  return html`<button type="button" class="card" data-action="open" data-key="${key}">
    <span class="card-top"><span class="card-icon accent">${icon("bot")}</span><span class="card-badges"><span class="badge">${info.format === "v1" ? "v1" : "agent"}</span></span></span>
    <span class="card-title">${info.format === "v1" && agent.name !== item.name ? agent.name : item.name}</span>
    <span class="card-text">${item.description}</span>
    <span class="card-meta"><span>${item.name}@${item.version}</span><span>${(agent.capabilities || []).length} capacidades</span><span>${(agent.skills || []).length} skills</span></span>
  </button>`;
}

function openAgent(entry, projects, navigate) {
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
      ${projects.length ? html`
        <div class="field"><label for="agentProject">Proyecto</label><select id="agentProject" required><option value="">Selecciona un proyecto</option>${projects.map((project) => html`<option value="${project.id}">${project.name}</option>`)}</select></div>
        <div class="row-actions"><button type="button" class="btn" data-action="compose">${icon("layers")}Ver composición</button></div>
        <div id="composition"></div>
        ${can.submitRuns() ? html`<form id="taskForm" class="stack" novalidate>
          <div class="field"><label for="agentTask">Tarea para el worker del proyecto</label><textarea id="agentTask" rows="4" required maxlength="50000" placeholder="Describe qué debe hacer el agente…"></textarea><p class="hint">La tarea queda en cola hasta que un worker autorizado la reclame.</p></div>
          <div class="form-error" role="alert" hidden></div>
          <div class="dialog-actions"><button type="submit" class="btn primary">${icon("play")}Enviar tarea</button></div>
        </form>` : html`<p class="hint">Tu rol no permite enviar tareas; solicita el rol de publicación.</p>`}`
      : html`<p class="muted">No tienes proyectos disponibles. Crea uno en <a href="#/projects">Proyectos</a>.</p>`}`,
  });
  const projectSelect = body.querySelector("#agentProject");
  delegate(body, {
    compose: async (button) => {
      if (!projectSelect.value) return projectSelect.focus(), toastError(new Error("Selecciona un proyecto."));
      setBusy(button, true);
      try {
        const { bundle } = await post("/agents/compose", { projectId: projectSelect.value, name: item.name, range: item.version });
        mount(body.querySelector("#composition"), html`<div class="composition">
          <dl class="definition-grid">
            <div><dt>Paquetes</dt><dd>${(bundle.packages || []).map((p) => p.name + "@" + p.version).join(", ") || "—"}</dd></div>
            <div><dt>Capacidades</dt><dd>${(bundle.capabilities || []).map((c) => c.name).join(", ") || "—"}</dd></div>
            <div><dt>Permisos</dt><dd>${(bundle.permissions || []).join(", ") || "Ninguno"}</dd></div>
            <div><dt>Digest</dt><dd><code>${String(bundle.digest || "").slice(0, 24)}…</code></dd></div>
          </dl></div>`);
      } catch (error) {
        toastError(error);
      } finally {
        setBusy(button, false);
      }
    },
  });
  const form = body.querySelector("#taskForm");
  if (form) bindForm(form, async () => {
    if (!projectSelect.value) throw new Error("Selecciona un proyecto.");
    await post("/runs", { projectId: projectSelect.value, name: item.name, range: item.version, task: form.agentTask.value });
    const projectId = projectSelect.value;
    closeDialog();
    toast("Tarea en cola. Un worker autorizado la ejecutará.");
    navigate("runs", { params: { projectId } });
  });
}

export default {
  id: "agents",
  label: "Agentes",
  icon: "bot",
  title: "Agentes",
  subtitle: "Combinan instrucciones, skills, herramientas y una política de memoria.",
  async render(root, { navigate, isCurrent }) {
    mount(root, html`
      <div class="callout tone-info">${icon("info")}<span>Activa un agente en tu proyecto con la CLI o envía una tarea a un worker autorizado desde aquí.</span></div>
      <div class="toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="agentSearch">Buscar agentes</label><input id="agentSearch" type="search" placeholder="Buscar agentes…"></div></div>
      <div id="agentResults">${skeletonCards(3)}</div>`);
    let agents = [], projects = [];
    const draw = () => {
      const q = root.querySelector("#agentSearch").value.trim().toLocaleLowerCase();
      const list = agents.filter(({ item, agent }) => !q || [item.name, item.description, agent.name, ...(agent.capabilities || [])].join(" ").toLocaleLowerCase().includes(q));
      mount(root.querySelector("#agentResults"), list.length
        ? html`<div class="card-grid">${list.map(agentCard)}</div>`
        : agents.length ? emptyState({ iconName: "search", title: "Sin resultados" })
          : emptyState({ iconName: "bot", title: "No hay agentes publicados", text: "Publica un paquete que declare un agente (type: agent o spec.contributes.agents)." }));
    };
    const load = async (force) => {
      try {
        const [packages, projectList] = await Promise.all([store.packages(force), store.projects(force).catch(() => [])]);
        agents = collectAgents(packages);
        projects = projectList;
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#agentResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#agentSearch").addEventListener("input", debounce(draw));
    delegate(root, {
      open: (button) => {
        const entry = agents.find((agent) => agent.key === button.dataset.key);
        if (entry) openAgent(entry, projects, navigate);
      },
      retry: () => load(true),
    });
    await load();
  },
};
