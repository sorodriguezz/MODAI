import { state } from "../state.js";
import { $, esc, modal, notify, submit } from "../lib/ui.js";
import { icon } from "../lib/icons.js";
import { controller } from "../lib/controller.js";
import { api } from "../lib/api.js";

export function renderAgents() {
  const list = state.packages.filter(
    (p) => p.type === "agent" && p.status === "active",
  );
  $("agentCards").innerHTML = list.length
    ? list
        .map(
          (p) =>
            '<button class="package-card" data-agent="' +
            esc(p.name) +
            '" data-version="' +
            esc(p.version) +
            '"><div class="package-top"><span class="package-icon">' +
            icon("spark") +
            '</span><span class="badge profile">agent</span></div><h3>' +
            esc(p.name) +
            "</h3><p>" +
            esc(p.description) +
            '</p><div class="package-bottom"><span>v' +
            esc(p.version) +
            "</span><span>" +
            (p.manifest.agent?.capabilities?.length || 0) +
            " capacidades</span><span>Ver agente ↗</span></div></button>",
        )
        .join("")
    : '<div class="panel empty" style="grid-column:1/-1"><h3>No hay agentes disponibles</h3><p>Publica un paquete de tipo agent desde la CLI.</p></div>';
  $("agentCards")
    .querySelectorAll("[data-agent]")
    .forEach(
      (e) =>
        (e.onclick = () => agentDetail(e.dataset.agent, e.dataset.version)),
    );
}
export function agentDetail(name, version) {
  const p = state.packages.find(
    (p) => p.name === name && p.version === version,
  );
  if (!p) return;
  const a = p.manifest.agent;
  modal(
    name + " · " + version,
    "<p>" +
      esc(p.description) +
      '</p><h3 style="margin-top:20px">Instrucciones</h3><pre>' +
      esc(a?.instructions || "") +
      "</pre><h3>Capacidades</h3><pre>" +
      esc((a?.capabilities || []).join("\n") || "Sin herramientas") +
      "</pre><p>Memoria: " +
      esc((a?.memory?.read || ["project"]).join(", ")) +
      " · Escritura: " +
      (a?.memory?.write ? "permitida" : "deshabilitada") +
      '</p><div class="copy-line"><code>modai agent activate ' +
      esc(name) +
      "@" +
      esc(version) +
      '</code></div><label for="agentProject">Proyecto</label><select id="agentProject" class="full"><option value="">Selecciona un proyecto</option>' +
      state.projectRecords
        .map(
          (p) =>
            '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>",
        )
        .join("") +
      '</select><div class="dialog-foot"><button class="btn" id="composeAgent">Ver composición</button></div><pre id="agentComposition" class="hidden"></pre>' +
      (["publisher", "admin"].includes(state.session?.role)
        ? '<form id="agentTaskForm"><label for="agentTask">Tarea para el worker del proyecto</label><textarea id="agentTask" required></textarea><div class="dialog-foot"><button class="btn primary">Enviar tarea</button></div></form>'
        : ""),
  );
  $("composeAgent").onclick = async () => {
    try {
      const projectId = $("agentProject").value;
      if (!projectId) throw new Error("Selecciona un proyecto");
      const d = await api("/agents/compose", "POST", {
        projectId,
        name,
        range: version,
      });
      $("agentComposition").textContent = JSON.stringify(
        {
          packages: d.bundle.packages.map((p) => p.name + "@" + p.version),
          capabilities: d.bundle.capabilities.map((c) => c.name),
          permissions: d.bundle.permissions,
          digest: d.bundle.digest,
        },
        null,
        2,
      );
      $("agentComposition").classList.remove("hidden");
    } catch (e) {
      notify(e.message, true);
    }
  };
  if ($("agentTaskForm"))
    $("agentTaskForm").onsubmit = (e) => {
      e.preventDefault();
      submit(e.target, async () => {
        const projectId = $("agentProject").value;
        if (!projectId) throw new Error("Selecciona un proyecto");
        await api("/runs", "POST", {
          projectId,
          name,
          range: version,
          task: $("agentTask").value,
        });
        $("modal").close();
        $("runProject").value = projectId;
        controller.navigate("runs");
        notify("Tarea en cola; espera a un worker autorizado");
      });
    };
}
