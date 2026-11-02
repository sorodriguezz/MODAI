import { state } from "../state.js";
import { $, esc, modal, notify, submit } from "../lib/ui.js";
import { api } from "../lib/api.js";
import { controller } from "../lib/controller.js";

function quote(value) {
  return (
    "'" +
    String(value).replaceAll(
      "'",
      $("connectShell").value === "powershell" ? "''" : "'\\''",
    ) +
    "'"
  );
}
export function connectionCommands(projectId = $("connectProject").value) {
  const url = new URL($("connectServer").value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Usa la URL HTTP(S) del servidor, sin ruta ni credenciales.",
    );
  const lines = [
    "npm install -g @modai/cli",
    "modai connect " + quote(url.origin),
  ];
  if (projectId) {
    lines.push("modai init --project " + quote(projectId), "modai status");
    const agent = $("connectAgent").value;
    if (agent)
      lines.push(
        "modai agent activate " +
          quote(agent) +
          " --adapter agents-md --allow project.instructions",
      );
  } else lines.push("modai project list");
  return lines.join("\n");
}
export function updateConnectionCommands() {
  try {
    $("connectCommands").textContent = connectionCommands();
    $("connectAddressNote").textContent = [
      "localhost",
      "127.0.0.1",
      "[::1]",
    ].includes(new URL($("connectServer").value).hostname)
      ? "Esta dirección sirve solo en el equipo del servidor. Para otros equipos usa su IP de red o dominio."
      : "Comparte esta dirección y una API key individual con cada cliente.";
    $("connectMcp").textContent = JSON.stringify(
      {
        mcpServers: {
          modai: {
            command: "modai-mcp",
            args: ["--project", "/RUTA/ABSOLUTA/DEL/PROYECTO"],
          },
        },
      },
      null,
      2,
    );
  } catch (error) {
    $("connectCommands").textContent = error.message;
  }
}
export function renderConnect() {
  const current = $("connectProject").value;
  $("connectProject").innerHTML =
    '<option value="">Selecciona un proyecto</option>' +
    state.projectRecords
      .map(
        (p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>",
      )
      .join("");
  if (state.projectRecords.some((p) => p.id === current))
    $("connectProject").value = current;
  const selected = $("connectAgent").value;
  $("connectAgent").innerHTML =
    '<option value="">Solo conectar; elegir agente después</option>' +
    state.packages
      .filter((p) => p.type === "agent" && p.status === "active")
      .map((p) => {
        const spec = p.name + "@" + p.version;
        return '<option value="' + esc(spec) + '">' + esc(spec) + "</option>";
      })
      .join("");
  $("connectAgent").value = selected;
  if (!$("connectServer").value)
    $("connectServer").value = state.publicUrl || location.origin;
  updateConnectionCommands();
}
export function connectProject(id) {
  renderConnect();
  $("connectProject").value = id;
  controller.navigate("connect");
  updateConnectionCommands();
}
export function grantClient() {
  const project = state.projectRecords.find(
    (p) => p.id === $("connectProject").value,
  );
  if (!project) return notify("Selecciona primero un proyecto.", true);
  let commands;
  try {
    commands = connectionCommands(project.id);
  } catch (error) {
    return notify(error.message, true);
  }
  modal(
    "Dar acceso a " + project.name,
    '<p>Crea una credencial individual para este proyecto. No compartas el token de administración.</p><form id="clientAccessForm"><label for="clientLabel">Persona o equipo</label><input class="full" id="clientLabel" maxlength="200" required placeholder="María · notebook"><label for="clientRole">Uso</label><select class="full" id="clientRole"><option value="publisher">Usar agentes, guardar memoria y enviar tareas</option><option value="reader">Consultar catálogo y memoria</option><option value="worker">Ejecutar tareas como worker</option></select><p class="small muted">La credencial no tiene namespaces de publicación asignados.</p><div class="dialog-foot"><button class="btn primary" type="submit">Crear acceso</button></div></form>',
  );
  $("clientAccessForm").onsubmit = (event) => {
    event.preventDefault();
    submit(event.target, async () => {
      const key = (
        await api("/admin/api-keys", "POST", {
          label: $("clientLabel").value,
          role: $("clientRole").value,
          projectIds: [project.id],
          packageScopes: [],
        })
      ).key;
      modal(
        "Acceso creado para " + key.label,
        '<div class="notice">El token se muestra una sola vez. Entrégalo al usuario por un canal privado; modai connect lo pedirá con entrada oculta.</div><label>API key</label><pre id="newSecret">' +
          esc(key.token) +
          '</pre><button class="btn" data-copy="newSecret">Copiar token</button><label>Comandos en la carpeta del proyecto del cliente</label><pre id="clientCommands">' +
          esc(commands) +
          '</pre><button class="btn primary" data-copy="clientCommands">Copiar comandos</button>' +
          (key.role === "worker"
            ? "<p>Para ejecutar la cola, configura también el modelo local y ejecuta <code>modai worker --project " +
              esc(quote(project.id)) +
              " --model MODELO_LOCAL</code>. La política de firmas del worker exige publicadores de confianza por defecto.</p>"
            : ""),
      );
    });
  };
}
