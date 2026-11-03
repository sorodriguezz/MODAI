// Project templates are packages of kind Template: a whole starter project (for example NestJS with SDD) that
// `modai template use` copies into a new folder, with optional features (--sdd) declared in modai.template.yaml.
// This module holds their editor (opened from Crear paquete or a template's detail) and the "create a project"
// section of the package detail. They are listed in Paquetes like any other kind.

import { get, post } from "../lib/api.js";
import { featureEditor } from "../lib/feature-editor.js";
import { bindFeaturePicker, featureList, featurePicker } from "../lib/feature-picker.js";
import { fileEditor } from "../lib/file-editor.js";
import { base64ToBytes, bytesToBase64, formatBytes, textToBytes, toArtifactFiles } from "../lib/files.js";
import { html, mount, toMarkup } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { bindCategorySearch, bindNamespaceSearch, categoryField, namespaceField } from "../lib/namespace-picker.js";
import {
  bindForm,
  closeDialog,
  closeDialogAndWait,
  codeBlock,
  errorState,
  openDialog,
  toast,
  toastError,
} from "../lib/ui.js";
import { bindVersionCheck } from "../lib/versions.js";
import { reviewList, wizard } from "../lib/wizard.js";
import { can, state, store } from "../state.js";

const MAX_BYTES = 25 * 1024 * 1024;
const TEMPLATE_MANIFEST = "modai.template.yaml";
/** Same exclusions as the server and the CLI: dependencies, build output, VCS data and local secrets. */
const EXCLUDED =
  /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.turbo|\.modai\/store|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/;
export const templateDownloadUrl = (name, version) =>
  "/api/v1/packages/download?name=" + encodeURIComponent(name) + "&version=" + encodeURIComponent(version);
const useCommand = (name, version, flags = []) =>
  `modai template use ${name}@${version} ./mi-proyecto${flags.length ? " " + flags.join(" ") : ""} --var projectName=mi-proyecto`;
const foldersOf = (paths) =>
  [...new Set(paths.filter((path) => path.includes("/")).map((path) => path.slice(0, path.lastIndexOf("/"))))].sort();

async function publishableNamespaces() {
  const publish = state.permissions?.publish || { all: false, namespaces: [] };
  return publish.all ? (await store.namespaces().catch(() => [])).map((n) => n.name) : publish.namespaces;
}

/**
 * Template wizard: files (in-panel editor, .zip or folder) → data → options (features) → review.
 * With `base` (a Template package record) it publishes the next version, starting from its files and options.
 */
export async function openTemplateEditor({ base, onPublished } = {}) {
  const [namespaces, categories] = await Promise.all([
    publishableNamespaces(),
    get("/categories")
      .then((r) => r.categories)
      .catch(() => []),
  ]);
  // The editor starts from the previous version's files (new version) or from a minimal skeleton (from scratch).
  const editorFiles = new Map();
  let declared = { features: [] };
  if (base) {
    try {
      const [{ files }, info] = await Promise.all([
        get("/artifacts/" + encodeURIComponent(base.artifactId)),
        get(
          "/packages/template?name=" + encodeURIComponent(base.name) + "&version=" + encodeURIComponent(base.version),
        ),
      ]);
      for (const file of files) editorFiles.set(file.path, base64ToBytes(file.content));
      declared = info;
    } catch (error) {
      return toastError(error);
    }
  } else {
    editorFiles.set(
      "README.md",
      textToBytes("# {{projectName}}\n\nQué es este proyecto, cómo se instala y cómo se ejecuta.\n"),
    );
    editorFiles.set(".gitignore", textToBytes("node_modules/\ndist/\n.env\n.modai/store/\n"));
    editorFiles.set(
      "AGENTS.md",
      textToBytes(
        "# Instrucciones para agentes de {{projectName}}\n\nConvenciones, comandos de verificación y límites del proyecto.\n",
      ),
    );
  }
  const [baseNamespace, baseShort] = base ? base.name.split("/") : ["", ""];
  const nextVersion = base
    ? base.version.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_, a, b, c) => `${a}.${b}.${Number(c) + 1}`)
    : "1.0.0";
  const baseCategory = base?.manifest?.spec?.category || "";
  const body = openDialog({
    title: base ? "Nueva versión de " + base.name : "Crear template de proyecto",
    description:
      "Un template es un proyecto completo para empezar (por ejemplo NestJS con SDD). Se publica como paquete; cada versión es inmutable y se usa con modai template use.",
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
        <p class="hint">Se excluyen <code>node_modules</code>, <code>.git</code>, <code>dist</code>, <code>build</code> y archivos <code>.env</code> (salvo <code>.env.example</code>). Máximo 25 MiB. Usa <code>{{projectName}}</code> u otros marcadores en archivos y rutas: <code>modai template use</code> los reemplaza. Pon los archivos de cada opción en su propia carpeta (por ejemplo <code>features/sdd/</code>).</p>
        <p class="muted small" id="tplSourceSummary" aria-live="polite"></p>
      </div></section>
      <section data-step="data" data-title="Datos"><div class="stack">
        <div class="field-row">
          ${namespaceField({ id: "tplNamespace", names: namespaces, selected: baseNamespace, readonly: Boolean(base) })}
          <div class="field"><label for="tplName">Nombre</label><input id="tplName" required pattern="[a-z0-9][a-z0-9._\\-]*" placeholder="nestjs-sdd" value="${baseShort}" ${base ? "readonly" : ""}></div>
          <div class="field"><label for="tplVersion">Versión</label><input id="tplVersion" required pattern="\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.\\-]+)?" value="${nextVersion}"><p class="hint" id="tplVersionHint">SemVer: 1.2.3</p></div>
        </div>
        <div class="field"><label for="tplDescription">Descripción</label><textarea id="tplDescription" rows="3" required maxlength="5000" placeholder="Qué incluye, para qué tipo de proyecto sirve y cómo se arranca.">${base?.description || ""}</textarea></div>
        <div class="field-row">
          ${categoryField({ id: "tplCategory", categories, selected: baseCategory, fallback: "template" })}
          <div class="field"><label for="tplTags">Etiquetas (opcional)</label><input id="tplTags" maxlength="400" placeholder="nestjs, postgres, sdd" value="${(base?.manifest?.metadata?.keywords || []).join(", ")}"><p class="hint">Tecnologías y temas; también sirven para buscar.</p></div>
        </div>
      </div></section>
      <section data-step="options" data-title="Opciones"><div class="stack">
        <p class="hint">Opciones que quien crea el proyecto activa con <code>modai template use @equipo/template --nombre</code> (y <code>--no-nombre</code> quita una activada por defecto). Cada una puede copiar una carpeta sobre el proyecto, rellenar marcadores y añadir paquetes MODAI a su <code>modai.yaml</code>. Se guardan en <code>${TEMPLATE_MANIFEST}</code>.</p>
        <p class="callout tone-info" id="tplZipNotice" hidden>${icon("info")}<span>Si tu .zip ya trae <code>${TEMPLATE_MANIFEST}</code>, se respeta mientras no cambies nada aquí. Si añades o editas opciones, estas lo reemplazan.</span></p>
        <div id="tplFeatures"></div>
        <fieldset class="field"><legend>Add-on</legend>
          <label class="check-inline"><input type="checkbox" id="tplAddon" ${declared.addon ? "checked" : ""}> Este template es una capa para combinar con otros (<code>--with</code>)</label>
          <div class="field" id="tplAddonForField" ${declared.addon ? "" : "hidden"}><label for="tplAddonFor">Para qué templates (vacío: cualquiera)</label><input id="tplAddonFor" value="${(declared.addon?.for || []).join(", ")}" placeholder="@equipo/springboot, @equipo/nestjs" spellcheck="false"></div>
        </fieldset>
      </div></section>
      <section data-step="review" data-title="Revisión"><div class="stack" id="tplReview"></div></section>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${icon("package")}Publicar template</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  let content = null,
    summary = null,
    addonTouched = false;
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
  /** Paths the template will have (null for a .zip: the browser does not read it). */
  const knownPaths = () =>
    source() === "editor" ? [...editorFiles.keys()] : source() === "folder" ? (summary?.paths ?? []) : null;
  const name = () => `${form.tplNamespace.value.trim()}/${form.tplName.value.trim()}`;
  const features = featureEditor(form.querySelector("#tplFeatures"), {
    id: "tplOpt",
    mode: "template",
    initial: declared.features,
    exclude: name,
    folders: () => {
      const paths = knownPaths();
      return paths ? foldersOf(paths) : [];
    },
  });
  form.addEventListener("change", async (event) => {
    if (event.target.id === "tplAddon") {
      addonTouched = true;
      form.querySelector("#tplAddonForField").hidden = !event.target.checked;
    }
    if (event.target.name === "tplSource") {
      form.querySelectorAll("[data-source]").forEach((el) => {
        el.hidden = el.dataset.source !== source();
      });
      content = null;
      summary = null;
      form.querySelector("#tplSourceSummary").textContent = "";
    }
    if (event.target.id === "tplZip" || event.target.id === "tplFolder") {
      content = null;
      summary = null;
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
          const kept = all
            .map((file) => ({ file, path: file.webkitRelativePath.split("/").slice(1).join("/") }))
            .filter((item) => item.path && !EXCLUDED.test(item.path));
          const size = kept.reduce((total, item) => total + item.file.size, 0);
          if (size > MAX_BYTES) throw new Error(`Los archivos suman ${formatBytes(size)}: el máximo es 25 MiB`);
          content = {
            files: await toArtifactFiles(
              await Promise.all(
                kept.map(async (item) => ({ path: item.path, bytes: new Uint8Array(await item.file.arrayBuffer()) })),
              ),
            ),
          };
          summary = {
            label: `${kept.length} archivos (${all.length - kept.length} excluidos)`,
            size,
            paths: kept.map((item) => item.path).sort(),
          };
        }
        box.textContent = `${summary.label} · ${formatBytes(summary.size)}`;
      } catch (error) {
        box.textContent = error.message;
      }
    }
  });
  form.querySelector("#tplAddonFor").addEventListener("input", () => {
    addonTouched = true;
  });
  bindNamespaceSearch(form, "tplNamespace", namespaces);
  bindCategorySearch(form, "tplCategory", categories, baseCategory);
  const versionCheck = bindVersionCheck({
    name,
    input: form.tplVersion,
    hint: form.querySelector("#tplVersionHint"),
    fetchVersions: async (full) =>
      (await get("/packages?includeYanked=true&name=" + encodeURIComponent(full))).packages.map((item) => item.version),
    watch: [form.tplNamespace, form.tplName],
  });
  const addonFor = () =>
    form.tplAddonFor.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  /** modai.template.yaml as the options step leaves it; undefined keeps the one the files bring. */
  const declaration = () =>
    features.touched || addonTouched
      ? { features: features.templateFeatures(), ...(form.tplAddon.checked ? { addon: { for: addonFor() } } : {}) }
      : undefined;
  wizard(form, {
    validate: {
      source: () => {
        if (source() !== "editor") return content ? "" : "Elige un archivo .zip o una carpeta.";
        if (editor.editing) return "Guarda o cancela el archivo que estás editando.";
        return editorFiles.size ? "" : "Agrega al menos un archivo.";
      },
      data: () =>
        !form.tplNamespace.value.trim()
          ? "Elige un namespace."
          : !can.publishTo(form.tplNamespace.value.trim())
            ? `No puedes publicar en ${form.tplNamespace.value.trim()}.`
            : versionCheck.problem(),
      options: () =>
        features.issue(knownPaths()) ||
        (form.tplAddon.checked && addonFor().some((item) => !/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(item))
          ? "Cada template del add-on es @namespace/nombre."
          : ""),
    },
    onEnter: {
      data: () => {
        if (source() === "editor")
          editorContent().catch((error) => {
            content = null;
            toastError(error);
          });
      },
      options: () => {
        form.querySelector("#tplZipNotice").hidden = source() !== "zip";
        features.refresh();
      },
      review: async () => {
        if (source() === "editor") await editorContent();
        const box = form.querySelector("#tplReview");
        const options = Object.keys(
          declaration()?.features ?? Object.fromEntries((declared.features || []).map((f) => [f.name, f])),
        );
        box.innerHTML = reviewList([
          ["Template", name() + "@" + form.tplVersion.value.trim()],
          ["Descripción", form.tplDescription.value.trim()],
          ["Categoría", form.tplCategory.value || "template"],
          [
            "Etiquetas",
            form.tplTags.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          ],
          ["Opciones", options.map((option) => "--" + option)],
          ["Contenido", summary ? `${summary.label} · ${formatBytes(summary.size)}` : ""],
        ]);
        if (summary?.paths)
          box.insertAdjacentHTML(
            "beforeend",
            toMarkup(
              html`<details class="disclosure"><summary>Archivos (${summary.paths.length})</summary><ul class="file-summary">${summary.paths.slice(0, 300).map((path) => html`<li><code>${path}</code></li>`)}${summary.paths.length > 300 ? html`<li class="muted">… y ${summary.paths.length - 300} más</li>` : ""}</ul></details>`,
            ),
          );
        box.insertAdjacentHTML(
          "beforeend",
          toMarkup(
            html`<p class="hint">Después se usa con:</p>${codeBlock("tplUse", useCommand(name(), form.tplVersion.value.trim(), options.length ? ["--" + options[0]] : []), "Copiar")}`,
          ),
        );
      },
    },
  });
  bindForm(form, async () => {
    const keywords = form.tplTags.value
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const { package: published } = await post("/packages/import-template", {
      name: name(),
      version: form.tplVersion.value.trim(),
      description: form.tplDescription.value.trim(),
      ...(form.tplCategory.value ? { category: form.tplCategory.value } : {}),
      ...(keywords.length ? { keywords } : {}),
      ...(declaration() ? { declaration: declaration() } : {}),
      ...content,
    });
    store.invalidate("summary");
    await closeDialogAndWait();
    toast(`Template ${published.name}@${published.version} publicado`);
    await onPublished?.(published);
  });
}

/** "Create a project" section of a Template package's detail: its options as checkboxes and the resulting command. */
export async function mountTemplateUsage(container, item) {
  let info;
  try {
    info = await get(
      "/packages/template?name=" + encodeURIComponent(item.name) + "&version=" + encodeURIComponent(item.version),
    );
  } catch (error) {
    return mount(container, errorState(error));
  }
  const features = featureList(info.features);
  mount(
    container,
    html`
    ${info.manifestError ? html`<div class="callout tone-warning">${icon("alert")}<span><b>${TEMPLATE_MANIFEST} no es válido:</b> ${info.manifestError}</span></div>` : ""}
    <h4>Crear un proyecto</h4>
    ${featurePicker("tplUseFeatures", features, html`Marca lo que quieres y el comando se arma solo. En la CLI: <code>modai template use ${item.name} --help</code>.`)}
    ${info.addon ? html`<div class="callout tone-info">${icon("info")}<span>Es un <b>add-on</b>${info.addon.for.length ? " para " + info.addon.for.join(", ") : ""}: se combina con otro template usando <code>--with ${item.name}</code>.</span></div>` : ""}
    ${codeBlock("tplUseCommand", useCommand(item.name, item.version), "Copiar")}
    <div class="row-actions"><a class="btn" href="${templateDownloadUrl(item.name, item.version)}" download>${icon("download")}Descargar .zip</a></div>
    <p class="hint">${info.files.length} archivos. Un template no se instala con <code>modai add</code>: crea un proyecto nuevo.</p>`,
  );
  bindFeaturePicker(container, "tplUseFeatures", features, (flags) => {
    const code = container.querySelector("#tplUseCommand");
    if (code) code.textContent = useCommand(item.name, item.version, flags);
  });
}
