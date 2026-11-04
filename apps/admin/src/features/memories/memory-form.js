import { patch, post } from "../../shared/lib/api.js";
import { html } from "../../shared/lib/html.js";
import { closeDialog, openDialog } from "../../shared/ui/dialog.js";
import { bindForm } from "../../shared/ui/form.js";
import { toast } from "../../shared/ui/toast.js";

export const kinds = {
  decision: "Decisión",
  convention: "Convención",
  learning: "Aprendizaje",
  note: "Nota",
  todo: "Pendiente",
};

function scopeField(project, memory) {
  if (memory) return "";
  return html`<div class="field"><label for="memoryScope">Alcance</label><select id="memoryScope"><option value="project">Proyecto</option>${project.organizationId ? html`<option value="organization">Organización (${project.organizationId})</option>` : ""}</select></div>`;
}

async function saveMemory(form, project, memory) {
  const kind = form.memoryKind.value.trim() || "note";
  if (memory) {
    await patch(`/memories/${encodeURIComponent(memory.id)}`, { content: form.memoryContent.value, kind });
    return;
  }
  await post("/memories", {
    projectId: project.id,
    content: form.memoryContent.value,
    kind,
    scope: form.memoryScope.value,
  });
}

export function memoryForm(project, memory, onSaved) {
  const body = openDialog({
    title: memory ? "Editar memoria" : "Añadir memoria",
    description: `Proyecto ${project.name}`,
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field-row">
        <div class="field"><label for="memoryKind">Tipo</label><input id="memoryKind" list="memoryKinds" maxlength="100" value="${memory?.kind || "decision"}"><datalist id="memoryKinds">${Object.keys(kinds).map((kind) => html`<option value="${kind}">${kinds[kind]}</option>`)}</datalist></div>
        ${scopeField(project, memory)}
      </div>
      <div class="field"><label for="memoryContent">¿Qué debe recordar el agente?</label><textarea id="memoryContent" rows="7" required maxlength="100000" placeholder="Una decisión, una convención o un aprendizaje…">${memory?.content || ""}</textarea></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Guardar</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    await saveMemory(form, project, memory);
    closeDialog();
    toast(memory ? "Memoria actualizada" : "Memoria guardada");
    await onSaved();
  });
}
