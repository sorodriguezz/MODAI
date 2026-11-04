import { can } from "../../app/state.js";
import { del } from "../../shared/lib/api.js";
import { delegate, html } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { confirmDialog, openDialog } from "../../shared/ui/dialog.js";
import { toast } from "../../shared/ui/toast.js";
import { documentEditor } from "./document-editor.js";

function origin(documentRecord) {
  if (!documentRecord.packageName) return "Documento manual";
  const version = documentRecord.packageVersion ? `@${documentRecord.packageVersion}` : "";
  return `Del paquete ${documentRecord.packageName}${version}`;
}

const tagList = (tags) =>
  tags.length ? html`<ul class="chip-list">${tags.map((tag) => html`<li class="chip">${tag}</li>`)}</ul>` : "";

const editActions = (editable) =>
  editable
    ? html`<div class="dialog-actions"><button type="button" class="btn ghost danger-text" data-action="delete">${icon("trash")}Eliminar</button><button type="button" class="btn primary" data-action="edit">${icon("edit")}Editar</button></div>`
    : "";

export function documentViewer(documentRecord, onChange) {
  const editable = !documentRecord.packageVersion && can.writeKnowledge(documentRecord.packageName);
  const body = openDialog({
    title: documentRecord.title,
    description: origin(documentRecord),
    size: "lg",
    body: html`
      ${tagList(documentRecord.tags || [])}
      <pre class="pre-wrap document">${documentRecord.content}</pre>
      ${documentRecord.packageVersion ? html`<p class="hint">Forma parte de un paquete versionado. Para cambiarlo publica una nueva versión del paquete.</p>` : ""}
      ${editActions(editable)}`,
  });
  delegate(body, {
    edit: () => documentEditor(documentRecord, onChange),
    delete: () =>
      confirmDialog({
        title: "Eliminar documento",
        message: `«${documentRecord.title}» dejará de estar disponible para los agentes.`,
        confirmLabel: "Eliminar",
        action: () => del(`/knowledge/documents/${encodeURIComponent(documentRecord.id)}`),
      }).then(async (ok) => {
        if (!ok) return;
        toast("Documento eliminado");
        await onChange();
      }),
  });
}
