import { state } from "../state.js";
import {
  $,
  esc,
  date,
  modal,
  confirmAction,
  notify,
  submit,
} from "../lib/ui.js";
import { api } from "../lib/api.js";
import { controller } from "../lib/controller.js";

export function renderKnowledge() {
  const q = $("knowledgeSearch").value.toLocaleLowerCase();
  const list = state.documents.filter((d) =>
    (d.title + " " + d.content + " " + (d.tags || []).join(" "))
      .toLocaleLowerCase()
      .includes(q),
  );
  $("knowledgeRows").innerHTML = list
    .map(
      (d) =>
        '<tr><td><button class="text-button" data-doc="' +
        esc(d.id) +
        '">' +
        esc(d.title) +
        '</button><div class="muted small">' +
        esc((d.tags || []).join(" · ")) +
        '</div></td><td><span class="badge">' +
        esc(d.packageName || "Documento manual") +
        '</span></td><td class="muted">' +
        date(d.updatedAt || d.createdAt) +
        "</td><td>↗</td></tr>",
    )
    .join("");
  $("knowledgeEmpty").classList.toggle("hidden", list.length > 0);
  $("knowledgeRows")
    .querySelectorAll("[data-doc]")
    .forEach((e) => (e.onclick = () => viewKnowledge(e.dataset.doc)));
}
export function viewKnowledge(id) {
  const d = state.documents.find((d) => d.id === id);
  modal(
    d.title,
    '<span class="badge">' +
      esc(d.packageName || "Documento manual") +
      "</span><pre>" +
      esc(d.content) +
      "</pre>" +
      (d.packageVersion
        ? "<p>Este documento forma parte de un paquete versionado. Para cambiarlo, publica una nueva versión del paquete.</p>"
        : ["admin", "publisher"].includes(state.session?.role)
          ? '<div class="dialog-foot"><button class="btn danger" id="deleteDoc">Eliminar</button><button class="btn primary" id="editDoc">Editar documento</button></div>'
          : ""),
  );
  if ($("editDoc")) $("editDoc").onclick = () => editKnowledge(id);
  if ($("deleteDoc"))
    $("deleteDoc").onclick = () =>
      confirmAction(
        "Eliminar documento",
        "Se eliminará «" + d.title + "» del conocimiento manual.",
        async () => {
          await api("/knowledge/documents/" + id, "DELETE");
          await controller.refresh();
          notify("Documento eliminado");
        },
      );
}
export function editKnowledge(id) {
  const d = state.documents.find((d) => d.id === id);
  modal(
    d ? "Editar documento" : "Nuevo documento",
    '<form id="documentForm"><label for="docTitle">Título</label><input class="full" id="docTitle" required value="' +
      esc(d?.title || "") +
      '"><label for="docTags">Etiquetas separadas por comas</label><input class="full" id="docTags" value="' +
      esc((d?.tags || []).join(", ")) +
      '" placeholder="arquitectura, convenciones"><label for="docContent">Contenido · Markdown</label><textarea id="docContent" required>' +
      esc(d?.content || "") +
      '</textarea><div class="dialog-foot"><button class="btn primary" type="submit">Guardar documento</button></div></form>',
  );
  $("documentForm").onsubmit = (e) => {
    e.preventDefault();
    submit(e.target, async () => {
      await api(
        "/knowledge/documents" + (id ? "/" + id : ""),
        id ? "PATCH" : "POST",
        {
          title: $("docTitle").value,
          content: $("docContent").value,
          tags: $("docTags")
            .value.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      );
      $("modal").close();
      await controller.refresh();
      notify("Documento guardado");
    });
  };
}
