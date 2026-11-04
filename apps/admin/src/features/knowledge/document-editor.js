import { can, state, store } from "../../app/state.js";
import { patch, post } from "../../shared/lib/api.js";
import { html } from "../../shared/lib/html.js";
import { bindComboSearch, comboField } from "../../shared/pickers/combo-field.js";
import { closeDialog, openDialog } from "../../shared/ui/dialog.js";
import { bindForm } from "../../shared/ui/form.js";
import { csv } from "../../shared/ui/format.js";
import { toast } from "../../shared/ui/toast.js";

const EVERYONE = "Todo el servidor";

async function writableNamespaces() {
  const publish = state.permissions?.publish || { all: false, namespaces: [] };
  return publish.all ? (await store.namespaces().catch(() => [])).map((n) => n.name) : publish.namespaces;
}

async function scopeOptions(editing) {
  const namespaces = editing ? [] : await writableNamespaces();
  return [
    ...(can.writeKnowledge() ? [{ value: EVERYONE, hint: "Lo encuentran todos los agentes del servidor" }] : []),
    ...namespaces.map((ns) => ({ value: ns, hint: "Solo quien ve este namespace" })),
  ];
}

function initialScope(documentRecord, scopes) {
  if (!documentRecord) {
    const first = scopes[0]?.value || "";
    return { selected: first, group: "", groupHidden: first === EVERYONE };
  }
  if (!documentRecord.packageName) return { selected: EVERYONE, group: "", groupHidden: true };
  const [scope, group = ""] = documentRecord.packageName.split("/");
  return { selected: scope, group, groupHidden: false };
}

function scopeFields(editing, scopes, initial) {
  return html`${comboField({
    id: "docScope",
    label: "Visible para",
    options: scopes,
    selected: initial.selected,
    readonly: editing,
    placeholder: "Elige dónde guardarlo",
    emptyText: "No puedes escribir conocimiento",
    emptyHint: "Pide acceso de publicación a un namespace a la administración de tu organización.",
  })}
        <div class="field" id="docGroupField" ${initial.groupHidden ? "hidden" : ""}><label for="docGroup">Agrupar como</label>
          <input id="docGroup" pattern="[a-z0-9][a-z0-9._\\-]*" maxlength="100" value="${initial.group || "guias"}" ${editing ? "readonly" : ""} spellcheck="false" autocapitalize="off">
          <p class="hint" id="docGroupHint"></p></div>`;
}

function bindScope(form) {
  const packageName = () =>
    form.docScope.value && form.docScope.value !== EVERYONE
      ? `${form.docScope.value}/${form.docGroup.value.trim()}`
      : "";
  const syncScope = () => {
    form.querySelector("#docGroupField").hidden = !packageName() && form.docScope.value === EVERYONE;
    form.querySelector("#docGroupHint").textContent = packageName()
      ? `Se guarda como ${packageName()}: lo ven quienes ven ${form.docScope.value}.`
      : "";
  };
  form.docScope.addEventListener("change", syncScope);
  form.docGroup.addEventListener("input", syncScope);
  syncScope();
  return packageName;
}

export async function documentEditor(documentRecord, onSaved) {
  const editing = Boolean(documentRecord);
  const scopes = await scopeOptions(editing);
  const body = openDialog({
    title: editing ? "Editar documento" : "Nuevo documento",
    description: "Conocimiento que los agentes encuentran con búsqueda. Quién lo ve depende de dónde lo guardes.",
    size: "lg",
    body: html`<form class="stack" novalidate>
      <div class="field-row">
        ${scopeFields(editing, scopes, initialScope(documentRecord, scopes))}
      </div>
      <div class="field"><label for="docTitle">Título</label><input id="docTitle" required maxlength="300" value="${documentRecord?.title || ""}"></div>
      <div class="field"><label for="docTags">Etiquetas</label><input id="docTags" value="${(documentRecord?.tags || []).join(", ")}" placeholder="arquitectura, convenciones"><p class="hint">Separadas por comas.</p></div>
      <div class="field"><label for="docContent">Contenido (Markdown)</label><textarea id="docContent" class="mono" rows="14" required>${documentRecord?.content || ""}</textarea></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Guardar documento</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  if (!editing) bindComboSearch(form, "docScope", scopes);
  const packageName = bindScope(form);
  bindForm(form, async () => {
    if (!editing && !form.docScope.value) throw new Error("Elige dónde guardar el documento.");
    const payload = {
      title: form.docTitle.value.trim(),
      content: form.docContent.value,
      tags: csv(form.docTags.value),
    };
    if (editing) await patch(`/knowledge/documents/${encodeURIComponent(documentRecord.id)}`, payload);
    else await post("/knowledge/documents", { ...payload, ...(packageName() ? { packageName: packageName() } : {}) });
    closeDialog();
    toast(editing ? "Documento actualizado" : "Documento creado");
    await onSaved();
  });
}
