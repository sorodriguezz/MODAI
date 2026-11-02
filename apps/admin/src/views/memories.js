import { state } from "../state.js";
import {
  $,
  notify,
  esc,
  date,
  confirmAction,
  modal,
  submit,
} from "../lib/ui.js";
import { api } from "../lib/api.js";

export async function loadMemories() {
  const project = $("projectId").value.trim();
  if (!project) return notify("Introduce el identificador del proyecto.", true);
  try {
    const d = await api("/memories?projectId=" + encodeURIComponent(project));
    $("memoryList").innerHTML = d.memories.length
      ? d.memories
          .map(
            (m) =>
              '<div class="panel-pad" style="border-bottom:1px solid var(--line)"><div class="row"><span class="badge">' +
              esc(m.kind) +
              " · " +
              esc(m.scope) +
              '</span><span class="small muted">' +
              date(m.updatedAt || m.createdAt) +
              "</span></div><pre>" +
              esc(m.content) +
              "</pre>" +
              (["publisher", "admin"].includes(state.session?.role)
                ? '<button class="btn danger" data-memory="' +
                  esc(m.id) +
                  '">Eliminar nota</button>'
                : "") +
              "</div>",
          )
          .join("")
      : '<div class="empty"><h3>Este proyecto aún no tiene recuerdos</h3><p>Añade una nota o deja que tu agente guarde decisiones mediante MCP.</p></div>';
    $("memoryList")
      .querySelectorAll("[data-memory]")
      .forEach(
        (e) =>
          (e.onclick = () =>
            confirmAction(
              "Eliminar nota",
              "Esta nota dejará de estar disponible para el proyecto.",
              async () => {
                await api("/memories/" + e.dataset.memory, "DELETE");
                await loadMemories();
                notify("Nota eliminada");
              },
            )),
      );
  } catch (e) {
    notify(e.message, true);
  }
}
export function newMemory() {
  if (!$("projectId").value.trim())
    return notify("Primero introduce el identificador del proyecto.", true);
  modal(
    "Añadir nota al proyecto",
    '<form id="memoryForm"><label for="memoryContent">¿Qué debe recordar tu agente?</label><textarea id="memoryContent" required placeholder="Una decisión, una convención o un aprendizaje…"></textarea><div class="dialog-foot"><button class="btn primary">Guardar nota</button></div></form>',
  );
  $("memoryForm").onsubmit = (e) => {
    e.preventDefault();
    submit(e.target, async () => {
      await api("/memories", "POST", {
        projectId: $("projectId").value.trim(),
        content: $("memoryContent").value,
      });
      $("modal").close();
      await loadMemories();
      notify("Nota guardada");
    });
  };
}
