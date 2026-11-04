import { bytesToText, cleanPath, textToBytes } from "../../../shared/lib/files.js";
import { html, mount } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { toast } from "../../../shared/ui/toast.js";
import { drawFiles, filesUnder } from "./files-table.js";
import { IGNORED, MAX_BYTES, slug, TEMPLATES } from "./package-types.js";

export function filesStep() {
  return html`<section data-step="files" data-title="Archivos"><div class="stack">
        <div class="toolbar">
          <h3 style="margin:0;flex:1">Archivos <span class="count" id="fileCount">0</span></h3>
          <button type="button" class="btn small" data-action="newFile">${icon("plus", 16)}Nuevo archivo</button>
          <label class="btn small">${icon("download", 16)}Subir archivos<input type="file" id="uploadFiles" multiple hidden></label>
          <label class="btn small">${icon("folder", 16)}Subir carpeta<input type="file" id="uploadFolder" webkitdirectory multiple hidden></label>
        </div>
        <p class="hint" id="uploadHint"></p>
        <div id="fileEditor"></div>
        <div id="fileList"></div>
      </div></section>`;
}

export function drawEditor({ s, $ }) {
  if (!s.editing) return mount($("fileEditor"), "");
  const root = TEMPLATES[s.template]?.root;
  const prefix = root ? `${root}/` : "";
  mount(
    $("fileEditor"),
    html`<div class="panel"><div class="panel-body stack">
      <div class="field"><label for="editPath">Ruta</label><input id="editPath" value="${s.editing.path ?? prefix}" placeholder="${prefix}archivo.ts"></div>
      <div class="field"><label for="editContent">Contenido</label><textarea id="editContent" class="mono" rows="12" spellcheck="false">${s.editing.text ?? ""}</textarea></div>
      <div class="dialog-actions"><button type="button" class="btn small ghost" data-action="cancelFile">Cancelar</button><button type="button" class="btn small primary" data-action="saveFile">Guardar archivo</button></div>
    </div></div>`,
  );
  const path = $("editPath");
  path.focus();
  path.setSelectionRange(path.value.length, path.value.length);
}

function uploadPath(s, file, folder, root) {
  let relative = folder ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
  if (!relative || IGNORED.test(relative)) return null;
  if (s.template === "skill") relative = `${s.skill}/${relative}`;
  return cleanPath((root ? `${root}/` : "") + relative);
}

function suggestComponentName({ s, $ }, fileList, folder) {
  if (s.template !== "component") return;
  if (!folder && !s.component.name) $("compName").value = slug(fileList[0]?.name.replace(/\.[^.]+$/, ""), "component");
  if (folder && !$("compName").value)
    $("compName").value = slug(fileList[0]?.webkitRelativePath.split("/")[0], "component");
}

async function addUploads(ctx, fileList, folder) {
  const { s } = ctx;
  const root = s.template === "existing" ? "" : TEMPLATES[s.template].root;
  let total = [...s.files.values()].reduce((sum, file) => sum + file.bytes.length, 0);
  let added = 0;
  for (const file of fileList) {
    const path = uploadPath(s, file, folder, root);
    if (!path) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    total += bytes.length - (s.files.get(path)?.bytes.length || 0);
    if (total > MAX_BYTES) throw new Error("El paquete superaría 25 MB; deja fuera dependencias y compilados.");
    s.files.set(path, { bytes });
    added++;
  }
  if (added) suggestComponentName(ctx, fileList, folder);
  toast(added + (added === 1 ? " archivo añadido" : " archivos añadidos"));
  ctx.refresh();
}

export function bindUploads(ctx) {
  for (const [id, folder] of [
    ["uploadFiles", false],
    ["uploadFolder", true],
  ])
    ctx.$(id).addEventListener("change", (event) =>
      addUploads(ctx, event.target.files, folder)
        .catch(ctx.showError)
        .finally(() => {
          event.target.value = "";
        }),
    );
}

function renameFolder({ s, $ }, from) {
  const to = cleanPath($("folderName").value);
  if (to === from) return;
  if (to.startsWith(`${from}/`)) throw new Error("Una carpeta no puede moverse dentro de sí misma.");
  const moves = filesUnder(s, from).map((path) => [path, to + path.slice(from.length)]);
  const clash = moves.find(([, next]) => s.files.has(next));
  if (clash) throw new Error(`Ya existe ${clash[1]}; elige otro nombre.`);
  for (const [path, next] of moves) {
    s.files.set(next, s.files.get(path));
    s.files.delete(path);
    s.starter.delete(path);
  }
}

function saveFile({ s, $ }) {
  const path = cleanPath($("editPath").value);
  if (s.editing.original && s.editing.original !== path) s.files.delete(s.editing.original);
  s.files.set(path, { bytes: textToBytes($("editContent").value) });
  s.starter.delete(path);
  s.editing = null;
}

function guarded(ctx, action) {
  try {
    action();
    ctx.clearError();
    ctx.refresh();
  } catch (error) {
    ctx.showError(error);
  }
}

export function fileActions(ctx) {
  const { s } = ctx;
  const edit = (editing) => {
    s.editing = editing;
    drawEditor(ctx);
  };
  const folder = (folderEdit) => {
    s.folderEdit = folderEdit;
    drawFiles(ctx);
  };
  return {
    newFile: () => edit({ path: null, text: "" }),
    editFile: (button) =>
      edit({
        original: button.dataset.path,
        path: button.dataset.path,
        text: bytesToText(s.files.get(button.dataset.path).bytes),
      }),
    cancelFile: () => edit(null),
    saveFile: () => guarded(ctx, () => saveFile(ctx)),
    removeFile: (button) => {
      s.files.delete(button.dataset.path);
      ctx.refresh();
    },
    renameFolder: (button) => folder({ dir: button.dataset.dir, mode: "rename" }),
    deleteFolder: (button) => folder({ dir: button.dataset.dir, mode: "delete" }),
    folderCancel: () => folder(null),
    renameFolderSave: (button) =>
      guarded(ctx, () => {
        renameFolder(ctx, button.dataset.dir);
        s.folderEdit = null;
      }),
    deleteFolderConfirm: (button) => {
      for (const path of filesUnder(s, button.dataset.dir)) s.files.delete(path);
      s.folderEdit = null;
      ctx.refresh();
    },
  };
}

export const validateFiles = ({ s }) =>
  s.files.size || s.template === "blank" || s.template === "existing" ? "" : "Añade al menos un archivo.";
