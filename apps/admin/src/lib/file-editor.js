// In-browser file tree for small projects: create, edit, rename, upload and delete files. Text files are edited
// in a textarea; binary files can only be replaced or removed. The caller owns the Map path → Uint8Array.

import { bytesToText, cleanPath, formatBytes, textToBytes } from "./files.js";
import { delegate, html, mount } from "./html.js";
import { icon } from "./icons.js";

const isText = (bytes) => bytesToText(bytes) !== null;

/**
 * @param {HTMLElement} root
 * @param {Map<string, Uint8Array>} files
 * @param {{ exclude?: RegExp, onChange?: () => void }} options
 */
export function fileEditor(root, files, { exclude, onChange } = {}) {
  let editing = null; // { path, isNew }
  mount(
    root,
    html`<div class="stack">
    <div class="toolbar">
      <h4 style="margin:0;flex:1">Archivos <span class="count" data-count>0</span></h4>
      <button type="button" class="btn small" data-action="feNew">${icon("plus", 16)}Nuevo archivo</button>
      <label class="btn small">${icon("download", 16)}Subir archivos<input type="file" data-upload multiple hidden></label>
      <label class="btn small">${icon("folder", 16)}Subir carpeta<input type="file" data-upload-folder webkitdirectory multiple hidden></label>
    </div>
    <div data-editor></div>
    <div data-list></div>
  </div>`,
  );
  const changed = () => {
    draw();
    onChange?.();
  };
  const draw = () => {
    root.querySelector("[data-count]").textContent = String(files.size);
    const paths = [...files.keys()].sort();
    mount(
      root.querySelector("[data-list]"),
      paths.length
        ? html`<div class="table-wrap"><table class="table file-table"><thead><tr><th scope="col">Ruta</th><th scope="col" class="hide-sm">Tamaño</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${paths.map(
          (
            path,
          ) => html`<tr><td><code>${path}</code></td><td class="hide-sm">${formatBytes(files.get(path).length)}</td>
          <td class="actions">${isText(files.get(path)) ? html`<button type="button" class="btn small ghost" data-action="feEdit" data-path="${path}" aria-label="Editar ${path}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>` : html`<span class="muted small">binario</span>`}
            <button type="button" class="icon-button small danger" data-action="feDelete" data-path="${path}" aria-label="Eliminar ${path}">${icon("trash", 16)}</button></td></tr>`,
        )}</tbody></table></div>`
        : html`<p class="muted small">Sin archivos. Crea uno o sube los de tu proyecto.</p>`,
    );
    mount(
      root.querySelector("[data-editor]"),
      editing
        ? html`<div class="panel panel-body stack file-editor">
          <div class="field"><label for="feEditPath">Ruta</label><input id="feEditPath" value="${editing.path}" placeholder="src/main.ts" spellcheck="false"><p class="hint">Usa <code>{{projectName}}</code> u otros marcadores: <code>modai template use</code> los reemplaza.</p></div>
          <div class="field"><label for="feEditContent">Contenido</label><textarea id="feEditContent" class="mono" rows="14" spellcheck="false">${editing.isNew ? "" : (bytesToText(files.get(editing.path)) ?? "")}</textarea></div>
          <p class="form-error" data-fe-error role="alert" hidden></p>
          <div class="dialog-actions" style="justify-content:flex-start"><button type="button" class="btn small primary" data-action="feSave">Guardar archivo</button><button type="button" class="btn small ghost" data-action="feCancel">Cancelar</button></div>
        </div>`
        : "",
    );
    if (editing) root.querySelector(editing.isNew ? "#feEditPath" : "#feEditContent")?.focus();
  };
  const add = async (list, folder) => {
    for (const file of list) {
      const relative = folder ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
      if (!relative || exclude?.test(relative)) continue;
      files.set(cleanPath(relative), new Uint8Array(await file.arrayBuffer()));
    }
    changed();
  };
  root
    .querySelector("[data-upload]")
    .addEventListener("change", (event) => add(event.target.files, false).finally(() => (event.target.value = "")));
  root
    .querySelector("[data-upload-folder]")
    .addEventListener("change", (event) => add(event.target.files, true).finally(() => (event.target.value = "")));
  delegate(root, {
    feNew: () => {
      editing = { path: "", isNew: true };
      draw();
    },
    feEdit: (button) => {
      editing = { path: button.dataset.path, isNew: false };
      draw();
    },
    feCancel: () => {
      editing = null;
      draw();
    },
    feDelete: (button) => {
      files.delete(button.dataset.path);
      if (editing?.path === button.dataset.path) editing = null;
      changed();
    },
    feSave: () => {
      const error = root.querySelector("[data-fe-error]");
      try {
        const path = cleanPath(root.querySelector("#feEditPath").value);
        if (exclude?.test(path)) throw new Error("Esa ruta no se incluye en templates: " + path);
        if (path !== editing.path && files.has(path)) throw new Error("Ya existe " + path);
        if (!editing.isNew && path !== editing.path) files.delete(editing.path);
        files.set(path, textToBytes(root.querySelector("#feEditContent").value));
        editing = null;
        changed();
      } catch (failure) {
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
