import { bindVersionCheck } from "../lib/versions.js";
import { bindFeaturePicker, featureList, featurePicker } from "../lib/feature-picker.js";
import { namespaceField, bindNamespaceSearch } from "../lib/namespace-picker.js";
import { html, mount, delegate, toMarkup } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get, post, patch } from "../lib/api.js";
import { openDialog, closeDialog, closeDialogAndWait, bindForm, toast, toastError, skeletonCards, emptyState, errorState, timeTag, debounce, codeBlock, statusBadge } from "../lib/ui.js";
import { base64ToBytes, bytesToBase64, formatBytes, textToBytes, toArtifactFiles } from "../lib/files.js";
import { fileEditor } from "../lib/file-editor.js";
import { wizard, reviewList } from "../lib/wizard.js";
import { store, state, can } from "../state.js";

const MAX_BYTES = 25 * 1024 * 1024;
/** Same exclusions as the server and the CLI: dependencies, build output, VCS data and local secrets. */
const EXCLUDED = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.turbo|\.modai\/store|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/;
const downloadUrl = (name, version) => "/api/v1/template/download?name=" + encodeURIComponent(name) + "&version=" + encodeURIComponent(version);
const useCommand = (name, version, flags = []) => `modai template use ${name}@${version} ./mi-proyecto${flags.length ? " " + flags.join(" ") : ""} --var projectName=mi-proyecto`;


async function publishableNamespaces() {
  const publish = state.permissions?.publish || { all: false, namespaces: [] };
  return publish.all ? (await store.namespaces().catch(() => [])).map((n) => n.name) : publish.namespaces;
}

/** Upload wizard: source (ZIP or folder) → data → review. With `base`, it publishes the next version of that template. */
async function templateForm(base, onSaved) {
  const namespaces = await publishableNamespaces();
  // The editor starts from the previous version's files (new version) or from a minimal skeleton (from scratch).
  const editorFiles = new Map();
  if (base) {
    try {
      const { files } = await get("/template/files?name=" + encodeURIComponent(base.name) + "&version=" + encodeURIComponent(base.version));
      for (const file of files) editorFiles.set(file.path, base64ToBytes(file.content));
    } catch (error) { return toastError(error); }
  } else {
    editorFiles.set("README.md", textToBytes("# {{projectName}}\n\nQué es este proyecto, cómo se instala y cómo se ejecuta.\n"));
    editorFiles.set(".gitignore", textToBytes("node_modules/\ndist/\n.env\n.modai/store/\n"));
    editorFiles.set("AGENTS.md", textToBytes("# Instrucciones para agentes de {{projectName}}\n\nConvenciones, comandos de verificación y límites del proyecto.\n"));
  }
  const [baseNamespace, baseShort] = base ? base.name.split("/") : ["", ""];
  const nextVersion = base ? base.version.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_, a, b, c) => `${a}.${b}.${Number(c) + 1}`) : "1.0.0";
  const body = openDialog({
    title: base ? "Nueva versión de " + base.name : "Subir template",
    description: "Un template es un proyecto completo para empezar (por ejemplo NestJS con SDD). Cada versión es inmutable; los proyectos se crean con modai template use.",
    size: "lg",
    body: html`<form class="stack wizard" novalidate>
      <section data-step="source" data-title="Archivos"><div class="stack">
        <fieldset class="field"><legend>¿Desde dónde?</legend><div class="role-options">
          <label class="role-option"><input type="radio" name="tplSource" value="editor" ${base ? "checked" : ""}><span><b>${icon("edit", 16)} ${base ? "Editar la versión " + base.version : "Crear aquí"}</b><span class="muted small">${base ? "Parte de sus archivos: cambia, agrega o elimina." : "Escribe o sube los archivos uno a uno, desde cero."}</span></span></label>
          <label class="role-option"><input type="radio" name="tplSource" value="zip" ${base ? "" : "checked"}><span><b>${icon("download", 16)} Archivo .zip</b><span class="muted small">El proyecto comprimido.</span></span></label>
          <label class="role-option"><input type="radio" name="tplSource" value="folder"><span><b>${icon("folder", 16)} Carpeta</b><span class="muted small">Elige la carpeta del proyecto modelo.</span></span></label>
        </div></fieldset>
        <div data-source="editor" ${base ? "" : "hidden"} id="tplEditor"></div>
        <div class="field" data-source="zip" ${base ? "hidden" : ""}><label for="tplZip">Archivo .zip</label><input id="tplZip" type="file" accept=".zip,application/zip"></div>
        <div class="field" data-source="folder" hidden><label for="tplFolder">Carpeta</label><input id="tplFolder" type="file" webkitdirectory multiple></div>
        <p class="hint">Se excluyen <code>node_modules</code>, <code>.git</code>, <code>dist</code>, <code>build</code> y archivos <code>.env</code> (salvo <code>.env.example</code>). Máximo 25 MiB. Usa <code>{{projectName}}</code> u otros marcadores en archivos y rutas: <code>modai template use</code> los reemplaza.</p>
        <p class="muted small" id="tplSourceSummary" aria-live="polite"></p>
      </div></section>
      <section data-step="data" data-title="Datos"><div class="stack">
        <div class="field-row">
          ${namespaceField({ id: "tplNamespace", names: namespaces, selected: baseNamespace, readonly: Boolean(base) })}
          <div class="field"><label for="tplName">Nombre</label><input id="tplName" required pattern="[a-z0-9][a-z0-9._\\-]*" placeholder="nestjs-sdd" value="${baseShort}" ${base ? "readonly" : ""}></div>
          <div class="field"><label for="tplVersion">Versión</label><input id="tplVersion" required pattern="\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.\\-]+)?" value="${nextVersion}"><p class="hint" id="tplVersionHint">SemVer: 1.2.3</p></div>
        </div>
        <div class="field"><label for="tplDescription">Descripción</label><textarea id="tplDescription" rows="3" required maxlength="2000" placeholder="Qué incluye, para qué tipo de proyecto sirve y cómo se arranca.">${base?.description || ""}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="tplStack">Stack (opcional)</label><input id="tplStack" maxlength="200" placeholder="NestJS 11 · SDD · PostgreSQL" value="${base?.stack || ""}"></div>
          <div class="field"><label for="tplTags">Etiquetas (opcional)</label><input id="tplTags" maxlength="400" placeholder="backend, api, sdd" value="${(base?.tags || []).join(", ")}"></div>
        </div>
      </div></section>
      <section data-step="review" data-title="Revisión"><div class="stack" id="tplReview"></div></section>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${icon("package")}Publicar template</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  let content = null, summary = null;
  const editor = fileEditor(form.querySelector("#tplEditor"), editorFiles, { exclude: EXCLUDED });
  // Content from the in-panel editor is built when leaving the step, so it always reflects the last edit.
  const editorContent = async () => {
    const entries = [...editorFiles].map(([path, bytes]) => ({ path, bytes }));
    const size = entries.reduce((total, entry) => total + entry.bytes.length, 0);
    if (size > MAX_BYTES) throw new Error(`Los archivos suman ${formatBytes(size)}: el máximo es 25 MiB`);
    content = { files: await toArtifactFiles(entries) };
    summary = { label: `${entries.length} archivos`, size, paths: entries.map((entry) => entry.path).sort() };
  };
  const source = () => form.querySelector('input[name="tplSource"]:checked').value;
  form.addEventListener("change", async (event) => {
    if (event.target.name === "tplSource") {
      form.querySelectorAll("[data-source]").forEach((el) => { el.hidden = el.dataset.source !== source(); });
      content = null; summary = null;
      form.querySelector("#tplSourceSummary").textContent = "";
    }
    if (event.target.id === "tplZip" || event.target.id === "tplFolder") {
      content = null; summary = null;
      const box = form.querySelector("#tplSourceSummary");
      try {
        if (event.target.id === "tplZip") {
          const file = event.target.files[0];
          if (!file) return;
          if (file.size > MAX_BYTES) throw new Error("El archivo supera 25 MiB");
          content = { archive: bytesToBase64(new Uint8Array(await file.arrayBuffer())) };
          summary = { label: file.name, size: file.size };
        } else {
          const all = [...event.target.files];
          const kept = all.map((file) => ({ file, path: file.webkitRelativePath.split("/").slice(1).join("/") })).filter((item) => item.path && !EXCLUDED.test(item.path));
          const size = kept.reduce((total, item) => total + item.file.size, 0);
          if (size > MAX_BYTES) throw new Error(`Los archivos suman ${formatBytes(size)}: el máximo es 25 MiB`);
          content = { files: await toArtifactFiles(await Promise.all(kept.map(async (item) => ({ path: item.path, bytes: new Uint8Array(await item.file.arrayBuffer()) })))) };
          summary = { label: `${kept.length} archivos (${all.length - kept.length} excluidos)`, size, paths: kept.map((item) => item.path).sort() };
        }
        box.textContent = `${summary.label} · ${formatBytes(summary.size)}`;
      } catch (error) { box.textContent = error.message; }
    }
  });
  bindNamespaceSearch(form, "tplNamespace", namespaces);
  const name = () => `${form.tplNamespace.value.trim()}/${form.tplName.value.trim()}`;
  const versionCheck = bindVersionCheck({
    name, input: form.tplVersion, hint: form.querySelector("#tplVersionHint"),
    fetchVersions: async (full) => { try { return (await get("/template?name=" + encodeURIComponent(full))).versions.map((item) => item.version); } catch { return []; } },
    watch: [form.tplNamespace, form.tplName],
  });
  wizard(form, {
    start: base ? 0 : 0,
    validate: {
      source: () => {
        if (source() !== "editor") return content ? "" : "Elige un archivo .zip o una carpeta.";
        if (editor.editing) return "Guarda o cancela el archivo que estás editando.";
        return editorFiles.size ? "" : "Agrega al menos un archivo.";
      },
      data: () => (!form.tplNamespace.value.trim() ? "Elige un namespace." : !can.publishTo(form.tplNamespace.value.trim()) ? `No puedes publicar en ${form.tplNamespace.value.trim()}.` : versionCheck.problem()),
    },
    onEnter: {
      data: () => { if (source() === "editor") editorContent().catch((error) => { content = null; toastError(error); }); },
      review: async () => {
        if (source() === "editor") await editorContent();
        const box = form.querySelector("#tplReview");
        box.innerHTML = reviewList([["Template", name() + "@" + form.tplVersion.value.trim()], ["Descripción", form.tplDescription.value.trim()], ["Stack", form.tplStack.value.trim()], ["Etiquetas", form.tplTags.value.split(",").map((t) => t.trim()).filter(Boolean)], ["Contenido", summary ? `${summary.label} · ${formatBytes(summary.size)}` : ""]]);
        if (summary?.paths) box.insertAdjacentHTML("beforeend", toMarkup(html`<ul class="file-summary">${summary.paths.slice(0, 300).map((path) => html`<li><code>${path}</code></li>`)}${summary.paths.length > 300 ? html`<li class="muted">… y ${summary.paths.length - 300} más</li>` : ""}</ul>`));
        box.insertAdjacentHTML("beforeend", toMarkup(html`<p class="hint">Después se usa con:</p>${codeBlock("tplUse", useCommand(name(), form.tplVersion.value.trim()), "Copiar")}`));
      },
    },
  });
  bindForm(form, async () => {
    const { template } = await post("/templates", { name: name(), version: form.tplVersion.value.trim(), description: form.tplDescription.value.trim(), ...(form.tplStack.value.trim() ? { stack: form.tplStack.value.trim() } : {}), tags: form.tplTags.value.split(",").map((t) => t.trim()).filter(Boolean), ...content });
    await closeDialogAndWait();
    toast(`Template ${template.name}@${template.version} publicado (${template.files} archivos)`);
    await onSaved(template);
  });
}

async function openTemplate(name, version, reload) {
  let detail;
  try { detail = await get("/template?name=" + encodeURIComponent(name) + (version ? "&version=" + encodeURIComponent(version) : "")); }
  catch (error) { return toastError(error); }
  const { template, versions, files, canPublish, features = [], addon } = detail;
  const body = openDialog({
    title: template.name,
    description: (template.stack ? template.stack + " · " : "") + "versión " + template.version,
    size: "lg",
    body: html`
      <p class="lead">${template.description}</p>
      ${template.tags.length ? html`<ul class="chip-list">${template.tags.map((tag) => html`<li class="chip">${tag}</li>`)}</ul>` : ""}
      <h4>Crear un proyecto</h4>
      ${featurePicker("tplFeatures", featureList(features), html`Marca lo que quieres y el comando se arma solo. En la CLI: <code>modai template use ${template.name} --help</code>.`)}
      ${addon ? html`<div class="callout tone-info">${icon("info")}<span>Es un <b>add-on</b>${addon.for.length ? " para " + addon.for.join(", ") : ""}: se combina con otro template usando <code>--with ${template.name}</code>.</span></div>` : ""}
      ${codeBlock("tplUseCommand", useCommand(template.name, template.version), "Copiar")}
      <div class="row-actions"><a class="btn" href="${downloadUrl(template.name, template.version)}" download>${icon("download")}Descargar .zip</a>${canPublish ? html`<button type="button" class="btn primary" data-action="newVersion">${icon("plus")}Nueva versión</button>` : ""}</div>
      <h4>Versiones</h4>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Versión</th><th scope="col">Estado</th><th scope="col" class="hide-sm">Publicada</th><th scope="col" class="hide-sm">Por</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${versions.map((v) => html`<tr><td><button type="button" class="link-button" data-action="version" data-version="${v.version}">${v.version}</button></td><td>${statusBadge(v.status)}</td><td class="hide-sm">${timeTag(v.publishedAt)}</td><td class="hide-sm">${v.publishedBy}</td>
          <td class="actions">${canPublish ? html`<button type="button" class="btn small ghost" data-action="toggle" data-version="${v.version}" data-status="${v.status === "active" ? "yanked" : "active"}">${v.status === "active" ? "Retirar" : "Restaurar"}</button>` : ""}</td></tr>`)}</tbody></table></div>
      <details class="disclosure"><summary>Archivos (${files.length} · ${formatBytes(template.sizeBytes)})</summary><ul class="file-summary">${files.map((f) => html`<li><code>${f.path}</code> <span class="muted small">${formatBytes(f.size)}</span></li>`)}</ul></details>`,
  });
  bindFeaturePicker(body, "tplFeatures", featureList(features), (flags) => { const code = body.querySelector("#tplUseCommand"); if (code) code.textContent = useCommand(template.name, template.version, flags); });
  delegate(body, {
    newVersion: () => templateForm(template, async (saved) => { await reload(); openTemplate(saved.name, saved.version, reload); }),
    version: (button) => openTemplate(template.name, button.dataset.version, reload),
    toggle: async (button) => {
      try {
        await patch("/templates", { name: template.name, version: button.dataset.version, status: button.dataset.status });
        toast(button.dataset.status === "yanked" ? "Versión retirada: ya no aparece como la última" : "Versión restaurada");
        await reload();
        openTemplate(template.name, template.version, reload);
      } catch (error) { toastError(error); }
    },
  });
}

export default {
  id: "templates",
  label: "Templates",
  icon: "layers",
  title: "Templates de proyecto",
  subtitle: "Proyectos completos para empezar con la estructura del equipo: se versionan, se descargan y se usan con la CLI.",
  async render(root, { actions, isCurrent }) {
    if (can.publish()) mount(actions, html`<button class="btn primary" data-action="create">${icon("plus")}Subir template</button>`);
    mount(root, html`
      <div class="toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="tplSearch">Buscar templates</label><input id="tplSearch" type="search" placeholder="Buscar por nombre, stack o etiqueta…"></div></div>
      <div id="tplResults">${skeletonCards(3)}</div>`);
    let templates = [];
    const draw = () => mount(root.querySelector("#tplResults"), templates.length
      ? html`<div class="card-grid">${templates.map((t) => html`<button type="button" class="card" data-action="open" data-name="${t.name}">
          <span class="card-top"><span class="card-icon accent">${icon("layers")}</span><span class="card-badges"><span class="badge">v${t.version}</span></span></span>
          <span class="card-title">${t.name}</span>
          <span class="card-text">${t.description}</span>
          <span class="card-meta">${t.stack ? html`<span>${t.stack}</span>` : ""}<span>${t.files} archivos</span><span>${t.versions} ${t.versions === 1 ? "versión" : "versiones"}</span></span>
        </button>`)}</div>`
      : emptyState({ iconName: "layers", title: root.querySelector("#tplSearch").value ? "Sin resultados" : "Aún no hay templates", text: "Sube un proyecto modelo (por ejemplo NestJS con SDD) para que el equipo arranque con la misma estructura. También desde la terminal: modai template publish ./carpeta --name @equipo/nestjs-sdd@1.0.0 --description \"…\"", action: can.publish() ? html`<button class="btn primary" data-action="create">${icon("plus")}Subir template</button>` : "" }));
    const load = async () => {
      try {
        const q = root.querySelector("#tplSearch").value.trim();
        templates = (await get("/templates" + (q ? "?q=" + encodeURIComponent(q) : ""))).templates;
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#tplResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#tplSearch").addEventListener("input", debounce(load, 250));
    const handlers = {
      create: () => templateForm(null, async (saved) => { await load(); openTemplate(saved.name, saved.version, load); }),
      open: (button) => openTemplate(button.dataset.name, undefined, load),
      retry: load,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
