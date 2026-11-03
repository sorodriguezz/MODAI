// Import a `.skill` file (a ZIP with SKILL.md): the server converts it into a package that contributes the skill.
import { html, mount, toMarkup } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post } from "../lib/api.js";
import { openDialog, closeDialog, closeDialogAndWait, bindForm, toast } from "../lib/ui.js";
import { bytesToBase64, formatBytes } from "../lib/files.js";
import { wizard, reviewList } from "../lib/wizard.js";
import { store, state } from "../state.js";
import { qualityMarkup } from "../lib/quality.js";

const MAX_BYTES = 25 * 1024 * 1024;

export async function openSkillImport({ onPublished } = {}) {
  const publish = state.permissions?.publish || { all: false, namespaces: [] };
  const namespaces = publish.all ? (await store.namespaces().catch(() => [])).map((n) => n.name) : publish.namespaces;
  const body = openDialog({
    title: "Subir skill (.skill)",
    description: "Un archivo .skill es un ZIP con SKILL.md (y sus referencias). Se publica como un paquete de tipo skill que cualquier proyecto puede instalar.",
    size: "lg",
    body: html`<form class="stack wizard" novalidate>
      <section data-step="file" data-title="Archivo"><div class="stack">
        <div class="field"><label for="skillFile">Archivo .skill o .zip</label><input id="skillFile" type="file" accept=".skill,.zip,application/zip" required><p class="hint">Máximo 25 MiB. También puedes hacerlo desde la terminal: <code>modai package publish mi-skill.skill --namespace @equipo</code>.</p></div>
      </div></section>
      <section data-step="where" data-title="Namespace"><div class="stack">
        <div class="field"><label for="skillNamespace">Namespace</label>
          ${publish.all || !namespaces.length ? html`<input id="skillNamespace" required pattern="@[a-z0-9][a-z0-9._\\-]*" placeholder="@skills" list="skillNamespaces"><datalist id="skillNamespaces">${namespaces.map((ns) => html`<option value="${ns}"></option>`)}</datalist>` : html`<select id="skillNamespace" required>${namespaces.map((ns) => html`<option value="${ns}">${ns}</option>`)}</select>`}
          <p class="hint">El paquete se llamará <code>namespace/nombre-de-la-skill</code>.</p></div>
        <div class="field-row">
          <div class="field"><label for="skillName">Nombre (opcional)</label><input id="skillName" maxlength="64" pattern="[a-z0-9][a-z0-9\\-]*" placeholder="Por defecto, el del frontmatter"></div>
          <div class="field"><label for="skillVersion">Versión (opcional)</label><input id="skillVersion" maxlength="100" pattern="\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.\\-]+)?" placeholder="1.0.0"></div>
        </div>
      </div></section>
      <section data-step="preview" data-title="Vista previa"><div class="stack" id="skillPreview"></div></section>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${icon("package")}Publicar skill</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  let archive = "";
  const request = (dryRun) => ({ archive, namespace: form.skillNamespace.value.trim(), ...(form.skillName.value.trim() ? { name: form.skillName.value.trim() } : {}), ...(form.skillVersion.value.trim() ? { version: form.skillVersion.value.trim() } : {}), ...(dryRun ? { dryRun: true } : {}) });
  form.skillFile.addEventListener("change", async () => {
    const file = form.skillFile.files[0];
    archive = "";
    if (!file) return;
    if (file.size > MAX_BYTES) { form.skillFile.setCustomValidity("El archivo supera 25 MiB"); return; }
    form.skillFile.setCustomValidity("");
    archive = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  });
  wizard(form, {
    validate: { file: () => (archive ? "" : "Elige un archivo .skill.") },
    onEnter: {
      preview: async () => {
        const box = form.querySelector("#skillPreview");
        mount(box, html`<p class="muted"><span class="spinner" aria-hidden="true"></span> Leyendo el archivo…</p>`);
        try {
          const preview = await post("/packages/import-skill", request(true));
          box.innerHTML = reviewList([["Paquete", preview.name + "@" + preview.manifest.metadata.version], ["Skill", preview.skill.name], ["Descripción", preview.skill.description]]);
          box.insertAdjacentHTML("beforeend", toMarkup(html`<h4>Archivos (${preview.files.length})</h4><ul class="file-summary">${preview.files.map((f) => html`<li><code>${f.path}</code> <span class="muted small">${formatBytes(f.size)}</span></li>`)}</ul>${qualityMarkup(preview.quality)}`));
        } catch (error) {
          mount(box, html`<div class="callout tone-danger">${icon("alert")}<span>${error.message}</span></div>`);
        }
      },
    },
  });
  bindForm(form, async () => {
    const { package: published } = await post("/packages/import-skill", request(false));
    await closeDialogAndWait();
    toast("Publicado " + published.name + "@" + published.version);
    store.invalidate("summary", "namespaces");
    await onPublished?.(published);
  });
}
