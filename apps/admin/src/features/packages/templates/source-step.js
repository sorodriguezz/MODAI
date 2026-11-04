import { bytesToBase64, formatBytes, toArtifactFiles } from "../../../shared/lib/files.js";
import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { EXCLUDED, MAX_BYTES } from "./template-common.js";

function sourceOptions(base) {
  return html`<label class="role-option"><input type="radio" name="tplSource" value="editor" ${base ? "checked" : ""}><span><b>${icon("edit", 16)} ${base ? `Editar la versión ${base.version}` : "Crear aquí"}</b><span class="muted small">${base ? "Parte de sus archivos: cambia, agrega o elimina." : "Escribe o sube los archivos uno a uno, desde cero."}</span></span></label>
          <label class="role-option"><input type="radio" name="tplSource" value="zip" ${base ? "" : "checked"}><span><b>${icon("download", 16)} Archivo .zip</b><span class="muted small">El proyecto comprimido.</span></span></label>
          <label class="role-option"><input type="radio" name="tplSource" value="folder"><span><b>${icon("folder", 16)} Carpeta</b><span class="muted small">Elige la carpeta del proyecto modelo.</span></span></label>`;
}

export function sourceStep({ base }) {
  return html`<section data-step="source" data-title="Archivos"><div class="stack">
        <fieldset class="field"><legend>¿Desde dónde?</legend><div class="role-options">
          ${sourceOptions(base)}
        </div></fieldset>
        <div data-source="editor" ${base ? "" : "hidden"} id="tplEditor"></div>
        <div class="field" data-source="zip" ${base ? "hidden" : ""}><label for="tplZip">Archivo .zip</label><input id="tplZip" type="file" accept=".zip,application/zip"></div>
        <div class="field" data-source="folder" hidden><label for="tplFolder">Carpeta</label><input id="tplFolder" type="file" webkitdirectory multiple></div>
        <p class="hint">Se excluyen <code>node_modules</code>, <code>.git</code>, <code>dist</code>, <code>build</code> y archivos <code>.env</code> (salvo <code>.env.example</code>). Máximo 25 MiB. Usa <code>{{projectName}}</code> u otros marcadores en archivos y rutas: <code>modai template use</code> los reemplaza. Pon los archivos de cada opción en su propia carpeta (por ejemplo <code>features/sdd/</code>).</p>
        <p class="muted small" id="tplSourceSummary" aria-live="polite"></p>
      </div></section>`;
}

export async function editorContent(ctx) {
  const entries = [...ctx.editorFiles].map(([path, bytes]) => ({ path, bytes }));
  const size = entries.reduce((total, entry) => total + entry.bytes.length, 0);
  if (size > MAX_BYTES) throw new Error(`Los archivos suman ${formatBytes(size)}: el máximo es 25 MiB`);
  ctx.content = { files: await toArtifactFiles(entries) };
  ctx.summary = { label: `${entries.length} archivos`, size, paths: entries.map((entry) => entry.path).sort() };
}

async function readZip(ctx, input) {
  const file = input.files[0];
  if (!file) return false;
  if (file.size > MAX_BYTES) throw new Error("El archivo supera 25 MiB");
  ctx.content = { archive: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
  ctx.summary = { label: file.name, size: file.size };
  return true;
}

async function readFolder(ctx, input) {
  const all = [...input.files];
  const kept = all
    .map((file) => ({ file, path: file.webkitRelativePath.split("/").slice(1).join("/") }))
    .filter((item) => item.path && !EXCLUDED.test(item.path));
  const size = kept.reduce((total, item) => total + item.file.size, 0);
  if (size > MAX_BYTES) throw new Error(`Los archivos suman ${formatBytes(size)}: el máximo es 25 MiB`);
  ctx.content = {
    files: await toArtifactFiles(
      await Promise.all(
        kept.map(async (item) => ({ path: item.path, bytes: new Uint8Array(await item.file.arrayBuffer()) })),
      ),
    ),
  };
  ctx.summary = {
    label: `${kept.length} archivos (${all.length - kept.length} excluidos)`,
    size,
    paths: kept.map((item) => item.path).sort(),
  };
  return true;
}

async function readUpload(ctx, input) {
  ctx.content = null;
  ctx.summary = null;
  const box = ctx.form.querySelector("#tplSourceSummary");
  try {
    const read = input.id === "tplZip" ? await readZip(ctx, input) : await readFolder(ctx, input);
    if (read) box.textContent = `${ctx.summary.label} · ${formatBytes(ctx.summary.size)}`;
  } catch (error) {
    box.textContent = error.message;
  }
}

export function handleSourceChange(ctx, target) {
  if (target.name === "tplSource") {
    ctx.form.querySelectorAll("[data-source]").forEach((el) => {
      el.hidden = el.dataset.source !== ctx.source();
    });
    ctx.content = null;
    ctx.summary = null;
    ctx.form.querySelector("#tplSourceSummary").textContent = "";
  }
  if (target.id === "tplZip" || target.id === "tplFolder") return readUpload(ctx, target);
}

export function validateSource(ctx) {
  if (ctx.source() !== "editor") return ctx.content ? "" : "Elige un archivo .zip o una carpeta.";
  if (ctx.editor.editing) return "Guarda o cancela el archivo que estás editando.";
  return ctx.editorFiles.size ? "" : "Agrega al menos un archivo.";
}
