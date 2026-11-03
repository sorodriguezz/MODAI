import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post, patch, del } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, confirmDialog, toast, skeletonRows, emptyState, errorState, timeTag, csv, debounce } from "../lib/ui.js";
import { store, can } from "../state.js";

function editor(documentRecord, onSaved) {
  const body = openDialog({
    title: documentRecord ? "Editar documento" : "Nuevo documento",
    description: "El conocimiento manual está disponible para todos los agentes mediante búsqueda.",
    size: "lg",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="docTitle">Título</label><input id="docTitle" required maxlength="300" value="${documentRecord?.title || ""}"></div>
      <div class="field"><label for="docTags">Etiquetas</label><input id="docTags" value="${(documentRecord?.tags || []).join(", ")}" placeholder="arquitectura, convenciones"><p class="hint">Separadas por comas.</p></div>
      <div class="field"><label for="docContent">Contenido (Markdown)</label><textarea id="docContent" class="mono" rows="14" required>${documentRecord?.content || ""}</textarea></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Guardar documento</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const payload = { title: form.docTitle.value.trim(), content: form.docContent.value, tags: csv(form.docTags.value) };
    if (documentRecord) await patch("/knowledge/documents/" + encodeURIComponent(documentRecord.id), payload);
    else await post("/knowledge/documents", payload);
    closeDialog();
    toast(documentRecord ? "Documento actualizado" : "Documento creado");
    await onSaved();
  });
}

function viewer(documentRecord, onChange) {
  const editable = !documentRecord.packageVersion && can.writeKnowledge();
  const body = openDialog({
    title: documentRecord.title,
    description: documentRecord.packageName ? "Del paquete " + documentRecord.packageName + (documentRecord.packageVersion ? "@" + documentRecord.packageVersion : "") : "Documento manual",
    size: "lg",
    body: html`
      ${(documentRecord.tags || []).length ? html`<ul class="chip-list">${documentRecord.tags.map((tag) => html`<li class="chip">${tag}</li>`)}</ul>` : ""}
      <pre class="pre-wrap document">${documentRecord.content}</pre>
      ${documentRecord.packageVersion ? html`<p class="hint">Forma parte de un paquete versionado. Para cambiarlo publica una nueva versión del paquete.</p>` : ""}
      ${editable ? html`<div class="dialog-actions"><button type="button" class="btn ghost danger-text" data-action="delete">${icon("trash")}Eliminar</button><button type="button" class="btn primary" data-action="edit">${icon("edit")}Editar</button></div>` : ""}`,
  });
  delegate(body, {
    edit: () => editor(documentRecord, onChange),
    delete: () => confirmDialog({
      title: "Eliminar documento",
      message: "«" + documentRecord.title + "» dejará de estar disponible para los agentes.",
      confirmLabel: "Eliminar",
      action: () => del("/knowledge/documents/" + encodeURIComponent(documentRecord.id)),
    }).then(async (ok) => {
      if (!ok) return;
      toast("Documento eliminado");
      await onChange();
    }),
  });
}

export default {
  id: "knowledge",
  label: "Conocimiento",
  icon: "book",
  title: "Conocimiento",
  subtitle: "Guías de tus paquetes y lo que tu equipo aprende, disponibles para cualquier agente.",
  async render(root, { actions, isCurrent }) {
    if (can.writeKnowledge()) mount(actions, html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo documento</button>`);
    mount(root, html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="docSearch">Buscar conocimiento</label><input id="docSearch" type="search" placeholder="Buscar en títulos, contenido y etiquetas…"></div>
        <label class="sr-only" for="docOrigin">Origen</label><select id="docOrigin"><option value="">Todos los orígenes</option><option value="manual">Documentos manuales</option><option value="package">De paquetes</option></select>
      </div>
      <p class="results-meta" id="docMeta" aria-live="polite"></p>
      <div class="panel" id="docResults">${skeletonRows(6, 3)}</div>`);
    let documents = [];
    const reload = async () => {
      store.invalidate("documents");
      await load();
    };
    const draw = () => {
      const q = root.querySelector("#docSearch").value.trim().toLocaleLowerCase();
      const origin = root.querySelector("#docOrigin").value;
      const list = documents.filter((d) => (!origin || (origin === "manual" ? !d.packageName : Boolean(d.packageName))) && (!q || (d.title + " " + d.content + " " + (d.tags || []).join(" ")).toLocaleLowerCase().includes(q)));
      root.querySelector("#docMeta").textContent = list.length + " de " + documents.length + " documentos" + (documents.length >= 500 ? " (se muestran los 500 más recientes)" : "");
      mount(root.querySelector("#docResults"), list.length
        ? html`<div class="table-wrap"><table class="table">
            <thead><tr><th scope="col">Documento</th><th scope="col" class="hide-sm">Origen</th><th scope="col">Actualizado</th></tr></thead>
            <tbody>${list.map((d) => html`<tr>
              <td><button type="button" class="link-button" data-action="view" data-id="${d.id}">${d.title}</button>${(d.tags || []).length ? html`<div class="muted small">${d.tags.join(" · ")}</div>` : ""}</td>
              <td class="hide-sm">${d.packageName ? html`<span class="badge">${d.packageName}</span>` : html`<span class="badge tone-info">Manual</span>`}</td>
              <td>${timeTag(d.updatedAt || d.createdAt)}</td></tr>`)}</tbody></table></div>`
        : documents.length ? emptyState({ iconName: "search", title: "Sin coincidencias", text: "Prueba con otras palabras." })
          : emptyState({ iconName: "book", title: "Aún no hay conocimiento", text: "Los paquetes con conocimiento lo añaden al publicarse. También puedes crear documentos manuales.", action: can.writeKnowledge() ? html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo documento</button>` : "" }));
    };
    const load = async (force) => {
      try {
        documents = await store.documents(force);
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#docResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#docSearch").addEventListener("input", debounce(draw));
    root.querySelector("#docOrigin").addEventListener("change", draw);
    const handlers = {
      new: () => editor(null, reload),
      view: (button) => {
        const record = documents.find((d) => d.id === button.dataset.id);
        if (record) viewer(record, reload);
      },
      retry: () => load(true),
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
