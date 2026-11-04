import { get } from "../../../shared/lib/api.js";
import { base64ToBytes } from "../../../shared/lib/files.js";
import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { wizard } from "../../../shared/lib/wizard.js";
import { closeDialog, openDialog } from "../../../shared/ui/dialog.js";
import { fileEditor } from "../../../shared/ui/file-editor.js";
import { bindForm } from "../../../shared/ui/form.js";
import { toastError } from "../../../shared/ui/toast.js";
import { templateInfo } from "../detail/template-usage.js";
import { bindDataStep, dataStep, validateData } from "./data-step.js";
import {
  bindAddon,
  createTemplateFeatures,
  enterOptions,
  handleAddonChange,
  optionsStep,
  validateOptions,
} from "./options-step.js";
import { enterReview, publishTemplate, reviewStep } from "./review-step.js";
import { editorContent, handleSourceChange, sourceStep, validateSource } from "./source-step.js";
import { EXCLUDED, publishableNamespaces, starterFiles } from "./template-common.js";

async function loadBase(base, editorFiles) {
  const [{ files }, info] = await Promise.all([
    get(`/artifacts/${encodeURIComponent(base.artifactId)}`),
    templateInfo(base.name, base.version),
  ]);
  for (const file of files) editorFiles.set(file.path, base64ToBytes(file.content));
  return info;
}

function templateForm(ctx) {
  return html`<form class="stack wizard" novalidate>
      ${sourceStep(ctx)}
      ${dataStep(ctx)}
      ${optionsStep(ctx)}
      ${reviewStep()}
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${icon("package")}Publicar template</button></div>
    </form>`;
}

function attachHelpers(ctx) {
  const { form } = ctx;
  ctx.source = () => form.querySelector('input[name="tplSource"]:checked').value;
  ctx.knownPaths = () => {
    const source = ctx.source();
    if (source === "editor") return [...ctx.editorFiles.keys()];
    return source === "folder" ? (ctx.summary?.paths ?? []) : null;
  };
  ctx.name = () => `${form.tplNamespace.value.trim()}/${form.tplName.value.trim()}`;
}

function startWizard(ctx) {
  wizard(ctx.form, {
    validate: {
      source: () => validateSource(ctx),
      data: () => validateData(ctx),
      options: () => validateOptions(ctx),
    },
    onEnter: {
      data: () => {
        if (ctx.source() === "editor")
          editorContent(ctx).catch((error) => {
            ctx.content = null;
            toastError(error);
          });
      },
      options: () => enterOptions(ctx),
      review: () => enterReview(ctx),
    },
  });
}

export async function openTemplateEditor({ base, onPublished } = {}) {
  const [namespaces, categories] = await Promise.all([
    publishableNamespaces(),
    get("/categories")
      .then((r) => r.categories)
      .catch(() => []),
  ]);
  const editorFiles = new Map();
  let declared = { features: [] };
  if (base) {
    try {
      declared = await loadBase(base, editorFiles);
    } catch (error) {
      return toastError(error);
    }
  } else starterFiles(editorFiles);
  const [baseNamespace, baseShort] = base ? base.name.split("/") : ["", ""];
  const ctx = { base, onPublished, namespaces, categories, editorFiles, declared, baseNamespace, baseShort };
  Object.assign(ctx, { baseCategory: base?.manifest?.spec?.category || "", content: null, summary: null });
  ctx.addonTouched = false;
  const body = openDialog({
    title: base ? `Nueva versión de ${base.name}` : "Crear template de proyecto",
    description:
      "Un template es un proyecto completo para empezar (por ejemplo NestJS con SDD). Se publica como paquete; cada versión es inmutable y se usa con modai template use.",
    size: "lg",
    body: templateForm(ctx),
  });
  ctx.form = body.querySelector("form");
  ctx.form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  attachHelpers(ctx);
  ctx.editor = fileEditor(ctx.form.querySelector("#tplEditor"), editorFiles, { exclude: EXCLUDED });
  ctx.features = createTemplateFeatures(ctx);
  ctx.form.addEventListener("change", async (event) => {
    handleAddonChange(ctx, event.target);
    await handleSourceChange(ctx, event.target);
  });
  bindAddon(ctx);
  bindDataStep(ctx);
  startWizard(ctx);
  bindForm(ctx.form, () => publishTemplate(ctx));
}
