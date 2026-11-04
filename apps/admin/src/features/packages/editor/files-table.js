import { bytesToText, formatBytes } from "../../../shared/lib/files.js";
import { html, mount } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";

export const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const filesUnder = (s, dir) => [...s.files.keys()].filter((path) => path.startsWith(`${dir}/`));
const plural = (count) => (count === 1 ? "archivo" : "archivos");

function fileRow(s, path) {
  const text = bytesToText(s.files.get(path).bytes);
  const dir = dirOf(path);
  return html`<tr>
      <td class="file-cell"><code>${path.slice(dir.length ? dir.length + 1 : 0)}</code>${text === null ? html` <span class="badge">binario</span>` : ""}</td>
      <td class="hide-sm">${formatBytes(s.files.get(path).bytes.length)}</td>
      <td class="actions">${text !== null ? html`<button type="button" class="btn small ghost" data-action="editFile" data-path="${path}">${icon("edit", 16)}Editar</button>` : ""}<button type="button" class="btn small ghost danger-text" data-action="removeFile" data-path="${path}" aria-label="Eliminar ${path}">${icon("trash", 16)}</button></td>
    </tr>`;
}

function folderActions(dir, count, editing) {
  if (editing === "rename")
    return html`<label class="sr-only" for="folderName">Nuevo nombre de ${dir}</label><input id="folderName" class="mono" value="${dir}"><button type="button" class="btn small primary" data-action="renameFolderSave" data-dir="${dir}">Guardar nombre</button><button type="button" class="btn small ghost" data-action="folderCancel">Cancelar</button>`;
  if (editing === "delete")
    return html`<span class="small">¿Eliminar ${count} ${plural(count)}?</span><button type="button" class="btn small danger" data-action="deleteFolderConfirm" data-dir="${dir}">Eliminar carpeta</button><button type="button" class="btn small ghost" data-action="folderCancel">Cancelar</button>`;
  return html`<button type="button" class="btn small ghost" data-action="renameFolder" data-dir="${dir}" aria-label="Renombrar la carpeta ${dir}">${icon("edit", 16)}Renombrar</button><button type="button" class="btn small ghost danger-text" data-action="deleteFolder" data-dir="${dir}" aria-label="Eliminar la carpeta ${dir}">${icon("trash", 16)}</button>`;
}

function folderRow(s, dir) {
  const count = filesUnder(s, dir).length;
  const editing = s.folderEdit?.dir === dir ? s.folderEdit.mode : null;
  return html`<tr class="folder-row" data-folder="${dir}"><td colspan="3"><div class="folder-head">
      ${icon("folder", 16)}<b><code>${dir}/</code></b><span class="muted small">${count} ${plural(count)}</span>
      <span class="folder-actions">${folderActions(dir, count, editing)}</span>
    </div></td></tr>`;
}

function tableMarkup(s, paths, total) {
  const groups = new Map();
  for (const path of paths) groups.set(dirOf(path), [...(groups.get(dirOf(path)) || []), path]);
  const dirs = [...groups.keys()].sort((x, y) => x.localeCompare(y));
  return html`<div class="table-wrap"><table class="table file-table"><thead><tr><th scope="col">Ruta en el paquete</th><th scope="col" class="hide-sm">Tamaño</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${dirs.map((dir) => html`${dir ? folderRow(s, dir) : ""}${groups.get(dir).map((path) => fileRow(s, path))}`)}</tbody></table></div><p class="hint">${formatBytes(total)} en total (máximo 25 MB).</p>`;
}

export function drawFiles({ s, $ }) {
  const paths = [...s.files.keys()].sort();
  const total = paths.reduce((sum, path) => sum + s.files.get(path).bytes.length, 0);
  $("fileCount").textContent = paths.length;
  mount(
    $("fileList"),
    paths.length ? tableMarkup(s, paths, total) : html`<p class="muted small">Sin archivos todavía.</p>`,
  );
  if (s.folderEdit?.mode !== "rename") return;
  const input = $("folderName");
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}
