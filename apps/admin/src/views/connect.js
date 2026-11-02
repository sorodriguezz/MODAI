import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post } from "../lib/api.js";
import { openDialog, bindForm, codeBlock, toastError } from "../lib/ui.js";
import { state, store, can, describeManifest, latestByName } from "../state.js";
import { showNewKey } from "./access.js";

function quote(value, shell) {
  return "'" + String(value).replaceAll("'", shell === "powershell" ? "''" : "'\\''") + "'";
}

function serverOrigin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Usa la URL HTTP(S) del servidor, sin ruta ni credenciales.");
  return url.origin;
}

function commands({ server, projectId, agent, shell }) {
  const lines = ["npm install -g @sorodriguez/modai", "modai connect " + quote(serverOrigin(server), shell)];
  if (projectId) {
    lines.push("modai init --project " + quote(projectId, shell), "modai status");
    if (agent) lines.push("modai agent activate " + quote(agent, shell) + " --adapter agents-md --allow project.instructions");
  } else lines.push("modai project list");
  return lines.join("\n");
}

export default {
  id: "connect",
  label: "Conectar un cliente",
  icon: "link",
  title: "Conectar un cliente",
  subtitle: "Instala la CLI, conéctala con una API key y enlaza tu editor mediante MCP.",
  async render(root, { params, isCurrent }) {
    mount(root, html`
      <div class="callout tone-info">${icon("info")}<span>La CLI, MCP y los workers se autentican con <b>API keys</b>, no con tu usuario del panel. ${can.admin() ? "Crea una por persona o equipo desde aquí." : "Pide una API key a la administración."} Requiere Node 26.13 o posterior (rama 26).</span></div>
      <ol class="steps">
        <li class="panel step">
          <div class="step-head"><span class="step-number" aria-hidden="true">1</span><div><h3>Elige el servidor y el proyecto</h3><p class="muted">Estos datos generan los comandos del paso 2.</p></div></div>
          <div class="panel-body stack">
            <div class="field"><label for="connectServer">Dirección accesible desde los equipos cliente</label><input id="connectServer" type="url" placeholder="https://modai.tu-dominio.cl" value="${state.health?.publicUrl || location.origin}"><p class="hint" id="connectAddressNote"></p></div>
            <div class="field-row">
              <div class="field"><label for="connectProject">Proyecto</label><select id="connectProject"><option value="">Sin proyecto (solo conectar)</option></select></div>
              <div class="field"><label for="connectShell">Terminal del cliente</label><select id="connectShell"><option value="posix">macOS / Linux</option><option value="powershell">Windows · PowerShell</option></select></div>
            </div>
            <div class="field"><label for="connectAgent">Agente que se activará (opcional)</label><select id="connectAgent"><option value="">Elegir después</option></select></div>
            <div class="row-actions">
              ${can.createProject() ? html`<a class="btn ghost" href="#/projects">${icon("plus")}Crear proyecto</a>` : ""}
              ${can.admin() ? html`<button type="button" class="btn primary" data-action="grant">${icon("key")}Crear API key para este proyecto</button>` : ""}
            </div>
          </div>
        </li>
        <li class="panel step">
          <div class="step-head"><span class="step-number" aria-hidden="true">2</span><div><h3>Ejecuta en la carpeta del proyecto del cliente</h3><p class="muted"><code>modai connect</code> pide la API key con entrada oculta y la guarda fuera del repositorio.</p></div></div>
          <div class="panel-body"><div id="connectCommands"></div>
          <p class="hint">Si otra persona ya inicializó el repositorio, usa <code>modai sync</code> en lugar de <code>modai init</code>.</p></div>
        </li>
        <li class="panel step">
          <div class="step-head"><span class="step-number" aria-hidden="true">3</span><div><h3>Conecta tu editor o agente mediante MCP</h3><p class="muted">Reemplaza la ruta absoluta del proyecto. El puente usa la conexión guardada por <code>modai connect</code>.</p></div></div>
          <div class="panel-body">${codeBlock("connectMcp", JSON.stringify({ mcpServers: { modai: { command: "modai-mcp", args: ["--project", "/RUTA/ABSOLUTA/DEL/PROYECTO"] } } }, null, 2), "Copiar configuración")}
          <p class="hint">Los agentes pueden leer AGENTS.md o cargar <code>modai://agent/active</code>. Para tareas en cola debe existir un worker activo (<code>modai worker</code>).</p></div>
        </li>
      </ol>`);
    const $server = root.querySelector("#connectServer"), $project = root.querySelector("#connectProject"), $shell = root.querySelector("#connectShell"), $agent = root.querySelector("#connectAgent");
    const update = () => {
      try {
        mount(root.querySelector("#connectCommands"), codeBlock("connectCommandText", commands({ server: $server.value, projectId: $project.value, agent: $agent.value, shell: $shell.value }), "Copiar comandos"));
        const host = new URL($server.value).hostname;
        root.querySelector("#connectAddressNote").textContent = ["localhost", "127.0.0.1", "[::1]"].includes(host)
          ? "Esta dirección solo funciona en el equipo del servidor. Para otros equipos usa su IP de red o dominio (MODAI_PUBLIC_URL)."
          : "Comparte esta dirección y una API key individual con cada cliente.";
        $server.removeAttribute("aria-invalid");
      } catch (error) {
        $server.setAttribute("aria-invalid", "true");
        mount(root.querySelector("#connectCommands"), html`<div class="callout tone-warning">${icon("alert")}<span>${error.message}</span></div>`);
      }
    };
    [$server, $project, $shell, $agent].forEach((input) => input.addEventListener(input.tagName === "INPUT" ? "input" : "change", update));
    update();
    let projects = [];
    try {
      const [projectList, packages] = await Promise.all([store.projects(), store.packages()]);
      if (!isCurrent()) return;
      projects = projectList;
      mount($project, html`<option value="">Sin proyecto (solo conectar)</option>${projects.map((p) => html`<option value="${p.id}">${p.name} (${p.id})</option>`)}`);
      const agents = latestByName(packages).filter((item) => describeManifest(item).agents.length || item.type === "agent");
      mount($agent, html`<option value="">Elegir después</option>${agents.map((item) => html`<option value="${item.name + "@" + item.version}">${item.name}@${item.version}</option>`)}`);
      const wanted = params.get("projectId");
      if (wanted && projects.some((p) => p.id === wanted)) $project.value = wanted;
      update();
    } catch (error) {
      toastError(error);
    }
    delegate(root, {
      grant: () => {
        const project = projects.find((p) => p.id === $project.value);
        if (!project) {
          $project.focus();
          return toastError(new Error("Selecciona primero un proyecto."));
        }
        let commandText;
        try {
          commandText = commands({ server: $server.value, projectId: project.id, agent: $agent.value, shell: $shell.value });
        } catch (error) {
          return toastError(error);
        }
        const body = openDialog({
          title: "Dar acceso a " + project.name,
          description: "Crea una API key individual para este proyecto. Nunca compartas el token de instalación.",
          size: "md",
          body: html`<form class="stack" novalidate>
            <div class="field"><label for="clientLabel">Persona o equipo</label><input id="clientLabel" required maxlength="200" placeholder="María · notebook"></div>
            <fieldset class="field"><legend>Uso</legend><div class="role-options">
              <label class="role-option"><input type="radio" name="clientRole" value="publisher" checked><span><b>Usar agentes</b><span class="muted small">Guardar memoria y enviar tareas.</span></span></label>
              <label class="role-option"><input type="radio" name="clientRole" value="reader"><span><b>Solo lectura</b><span class="muted small">Consultar catálogo y memoria.</span></span></label>
              <label class="role-option"><input type="radio" name="clientRole" value="worker"><span><b>Worker</b><span class="muted small">Ejecutar tareas de la cola.</span></span></label>
            </div></fieldset>
            <p class="hint">La API key no podrá publicar paquetes (sin namespaces asignados).</p>
            <div class="form-error" role="alert" hidden></div>
            <div class="dialog-actions"><button type="submit" class="btn primary">Crear acceso</button></div>
          </form>`,
        });
        const form = body.querySelector("form");
        bindForm(form, async () => {
          const role = form.querySelector('input[name="clientRole"]:checked').value;
          const { key } = await post("/admin/api-keys", { label: form.clientLabel.value.trim(), role, projectIds: [project.id], packageScopes: [] });
          showNewKey(key, html`<h4>Comandos para el cliente</h4>${codeBlock("clientCommands", commandText, "Copiar comandos")}
            ${role === "worker" ? html`<p class="hint">Para ejecutar la cola configura un modelo local y ejecuta <code>modai worker --project ${quote(project.id, $shell.value)} --model MODELO_LOCAL</code>.</p>` : ""}`);
        });
      },
    });
  },
};
