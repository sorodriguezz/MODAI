import { can, store } from "../../../app/state.js";
import { post } from "../../../shared/lib/api.js";
import { toArtifactFiles } from "../../../shared/lib/files.js";
import { html, mount } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { qualityMarkup } from "../../../shared/lib/quality.js";
import { resetDependencyCatalog } from "../../../shared/pickers/dependency-picker.js";
import { closeDialogAndWait } from "../../../shared/ui/dialog.js";
import { setBusy } from "../../../shared/ui/form.js";
import { toast } from "../../../shared/ui/toast.js";
import { currentManifest } from "./editor-state.js";

export function reviewStep({ s, base }) {
  return html`<section data-step="review" data-title="Revisión"><div class="stack">
      <p class="hint">Se valida automáticamente al llegar aquí. Las versiones publicadas son inmutables.</p>
      <div id="validation" aria-live="polite"></div>
      <div><button type="button" class="btn small" data-action="validate">${icon("check", 16)}Volver a validar</button></div>
      <details class="disclosure" ${base || s.template === "blank" ? "open" : ""}><summary>Manifiesto (modai.package.yaml en JSON)</summary>
        <p class="hint">Se genera desde el formulario. Si lo editas a mano, tus cambios se respetan al publicar.</p>
        <textarea id="pkgManifest" class="mono" rows="14" spellcheck="false"></textarea>
        <div class="dialog-actions" style="justify-content:flex-start"><button type="button" class="btn small ghost" data-action="regenerate">${icon("refresh", 16)}Regenerar desde el formulario</button></div>
      </details>
      </div></section>`;
}

const artifactFiles = (s) => toArtifactFiles([...s.files].map(([path, file]) => ({ path, bytes: file.bytes })));

export async function validatePackage(ctx, button) {
  ctx.clearError();
  setBusy(button, true);
  try {
    const { quality } = await post("/packages/validate", {
      manifest: currentManifest(ctx),
      files: await artifactFiles(ctx.s),
    });
    mount(ctx.$("validation"), qualityMarkup(quality));
  } catch (error) {
    ctx.showError(error);
  } finally {
    setBusy(button, false);
  }
}

async function publish(ctx) {
  const manifest = currentManifest(ctx);
  const namespace = String(manifest.metadata?.name ?? manifest.name ?? "").split("/")[0];
  if (namespace && !can.publishTo(namespace))
    throw new Error(
      `No tienes permiso para publicar en ${namespace}. Pide acceso a la administración de su organización.`,
    );
  const { package: published } = await post("/packages", { manifest, files: await artifactFiles(ctx.s) });
  store.invalidate("summary", "agents", "documents");
  resetDependencyCatalog();
  await closeDialogAndWait();
  toast(`Publicado ${published.name}@${published.version}`);
  await ctx.onPublished?.(published);
}

export function bindPublish(ctx) {
  const { form } = ctx;
  const submit = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    ctx.clearError();
    if (!form.checkValidity()) {
      const invalid = form.querySelector(":invalid");
      invalid?.focus();
      return ctx.showError(new Error(invalid?.validationMessage || "Revisa el formulario."));
    }
    setBusy(submit, true);
    try {
      await publish(ctx);
    } catch (error) {
      ctx.showError(error);
    } finally {
      if (document.contains(submit)) setBusy(submit, false);
    }
  });
}
