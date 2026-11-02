import { state } from "../state.js";
import { $, esc, date, notify, modal, confirmAction } from "../lib/ui.js";
import { api } from "../lib/api.js";

export async function loadRuns() {
  const projectId = $("runProject").value;
  if (!projectId) {
    $("runRows").innerHTML = "";
    $("runEmpty").classList.remove("hidden");
    $("runEmpty").textContent =
      "Selecciona un proyecto para consultar sus ejecuciones.";
    return;
  }
  try {
    state.runRecords = (
      await api("/runs?projectId=" + encodeURIComponent(projectId))
    ).runs;
    $("runRows").innerHTML = state.runRecords
      .map(
        (r) =>
          '<tr><td><button class="text-button" aria-label="Ver resultado" data-run="' +
          esc(r.id) +
          '">' +
          esc(r.agentName) +
          '</button><div class="muted small">v' +
          esc(r.agentVersion) +
          "</div></td><td>" +
          esc(r.task.slice(0, 100)) +
          '</td><td><span class="badge ' +
          (r.status === "completed"
            ? "active"
            : r.status === "failed"
              ? "yanked"
              : r.status === "running"
                ? "profile"
                : "") +
          '">' +
          esc(r.status) +
          "</span></td><td>" +
          date(r.updatedAt) +
          "</td></tr>",
      )
      .join("");
    $("runEmpty").classList.toggle("hidden", state.runRecords.length > 0);
    $("runEmpty").textContent = "Este proyecto no tiene ejecuciones.";
    $("runRows")
      .querySelectorAll("[data-run]")
      .forEach((e) => (e.onclick = () => runDetail(e.dataset.run)));
  } catch (e) {
    notify(e.message, true);
  }
}
export function runDetail(id) {
  const r = state.runRecords.find((r) => r.id === id);
  if (!r) return;
  modal(
    "Ejecución · " + r.status,
    "<p>" +
      esc(r.agentName) +
      "@" +
      esc(r.agentVersion) +
      " · Intentos: " +
      r.attempts +
      '</p><h3 style="margin-top:20px">Tarea</h3><pre>' +
      esc(r.task) +
      "</pre><h3>Resultado</h3><pre>" +
      esc(r.result || r.error || "Esperando ejecución del worker…") +
      '</pre><p class="small">Definición: ' +
      esc(r.bundle.digest) +
      "</p>" +
      (["queued", "running"].includes(r.status) &&
      ["publisher", "admin"].includes(state.session?.role)
        ? '<div class="dialog-foot"><button class="btn danger" id="cancelRun">Cancelar tarea</button></div>'
        : ""),
  );
  if ($("cancelRun"))
    $("cancelRun").onclick = () =>
      confirmAction(
        "Cancelar tarea",
        "El worker perderá la asignación de esta tarea.",
        async () => {
          await api("/runs/" + encodeURIComponent(id) + "/cancel", "POST", {});
          await loadRuns();
          notify("Tarea cancelada");
        },
      );
}
