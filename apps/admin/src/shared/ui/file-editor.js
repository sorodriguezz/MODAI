import { bytesToText, cleanPath, formatBytes, textToBytes } from "../lib/files.js";
import { delegate, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";

const isText = (bytes) => bytesToText(bytes) !== null;

const shell = () => html`<div class="stack">
    <div class="toolbar">
      <h4 style="margin:0;flex:1">Archivos <span class="count" data-count>0</span></h4>
      <button type="button" class="btn small" data-action="feNew">${icon("plus", 16)}Nuevo archivo</button>
      <label class="btn small">${icon("download", 16)}Subir archivos<input type="file" data-upload multiple hidden></label>
      <label class="btn small">${icon("folder", 16)}Subir carpeta<input type="file" data-upload-folder webkitdirectory multiple hidden></label>
    </div>
    <div data-editor></div>
    <div data-list></div>
  </div>`;

function fileRow(files, path) {
  const action = isText(files.get(path))
    ? html`<button type="button" class="btn small ghost" data-action="feEdit" data-path="${path}" aria-label="Editar ${path}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>`
    : html`<span class="muted small">binario</span>`;
  return html`<tr><td><code>${path}</code></td><td class="hide-sm">${formatBytes(files.get(path).length)}</td>
          <td class="actions">${action}
            <button type="button" class="icon-button small danger" data-action="feDelete" data-path="${path}" aria-label="Eliminar ${path}">${icon("trash", 16)}</button></td></tr>`;
}

function listMarkup(files) {
  const paths = [...files.keys()].sort();
  if (!paths.length) return html`<p class="muted small">Sin archivos. Crea uno o sube los de tu proyecto.</p>`;
  return html`<div class="table-wrap"><table class="table file-table"><thead><tr><th scope="col">Ruta</th><th scope="col" class="hide-sm">Tamaño</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${paths.map((path) => fileRow(files, path))}</tbody></table></div>`;
}

function editorMarkup(files, editing) {
  if (!editing) return "";
  const content = editing.isNew ? "" : (bytesToText(files.get(editing.path)) ?? "");
  return html`<div class="panel panel-body stack file-editor">
          <div class="field"><label for="feEditPath">Ruta</label><input id="feEditPath" value="${editing.path}" placeholder="src/main.ts" spellcheck="false"><p class="hint">Usa <code>{{projectName}}</code> u otros marcadores: <code>modai template use</code> los reemplaza.</p></div>
          <div class="field"><label for="feEditContent">Contenido</label><textarea id="feEditContent" class="mono" rows="14" spellcheck="false">${content}</textarea></div>
          <p class="form-error" data-fe-error role="alert" hidden></p>
          <div class="dialog-actions" style="justify-content:flex-start"><button type="button" class="btn small primary" data-action="feSave">Guardar archivo</button><button type="button" class="btn small ghost" data-action="feCancel">Cancelar</button></div>
        </div>`;
}

function savePath(root, files, editing, exclude) {
  const path = cleanPath(root.querySelector("#feEditPath").value);
  if (exclude?.test(path)) throw new Error(`Esa ruta no se incluye en templates: ${path}`);
  if (path !== editing.path && files.has(path)) throw new Error(`Ya existe ${path}`);
  if (!editing.isNew && path !== editing.path) files.delete(editing.path);
  files.set(path, textToBytes(root.querySelector("#feEditContent").value));
}

export function fileEditor(root, files, { exclude, onChange } = {}) {
  let editing = null;
  mount(root, shell());
  const draw = () => {
    root.querySelector("[data-count]").textContent = String(files.size);
    mount(root.querySelector("[data-list]"), listMarkup(files));
    mount(root.querySelector("[data-editor]"), editorMarkup(files, editing));
    if (editing) root.querySelector(editing.isNew ? "#feEditPath" : "#feEditContent")?.focus();
  };
  const changed = () => {
    draw();
    onChange?.();
  };
  const add = async (list, folder) => {
    for (const file of list) {
      const relative = folder ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
      if (!relative || exclude?.test(relative)) continue;
      files.set(cleanPath(relative), new Uint8Array(await file.arrayBuffer()));
    }
    changed();
  };
  const onUpload = (folder) => (event) =>
    add(event.target.files, folder).finally(() => {
      event.target.value = "";
    });
  root.querySelector("[data-upload]").addEventListener("change", onUpload(false));
  root.querySelector("[data-upload-folder]").addEventListener("change", onUpload(true));
  const edit = (next) => {
    editing = next;
    draw();
  };
  delegate(root, {
    feNew: () => edit({ path: "", isNew: true }),
    feEdit: (button) => edit({ path: button.dataset.path, isNew: false }),
    feCancel: () => edit(null),
    feDelete: (button) => {
      files.delete(button.dataset.path);
      if (editing?.path === button.dataset.path) editing = null;
      changed();
    },
    feSave: () => {
      try {
        savePath(root, files, editing, exclude);
        editing = null;
        changed();
      } catch (failure) {
        const error = root.querySelector("[data-fe-error]");
        error.textContent = failure.message;
        error.hidden = false;
      }
    },
  });
  draw();
  return {
    draw,
    get editing() {
      return Boolean(editing);
    },
  };
}
