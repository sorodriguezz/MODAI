import { state, store } from "../../../app/state.js";
import { get } from "../../../shared/lib/api.js";
import { base64ToBytes } from "../../../shared/lib/files.js";
import { delegate, html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { bindVersionCheck } from "../../../shared/lib/versions.js";
import { wizard } from "../../../shared/lib/wizard.js";
import { bindNamespaceSearch } from "../../../shared/pickers/namespace-field.js";
import { closeDialog, openDialog } from "../../../shared/ui/dialog.js";
import { toastError } from "../../../shared/ui/toast.js";
import { applyKind, createDependencies, dependenciesStep, validateDependencies } from "./dependencies-step.js";
import { currentManifest, loadStarter, readForm, syncManifest, untouchedStarter } from "./editor-state.js";
import { bindUploads, drawEditor, fileActions, filesStep, validateFiles } from "./files-step.js";
import { drawFiles } from "./files-table.js";
import { drawTemplateFields, identityStep, validateIdentity } from "./identity-step.js";
import { bumpPatch } from "./manifest-builder.js";
import { createFeatures, optionsStep, skipOptions } from "./options-step.js";
import { bindPublish, reviewStep, validatePackage } from "./review-step.js";
import { bindTypeStep, typeStep, validateType } from "./type-step.js";

function initialState(base, template) {
  return {
    template: base ? "existing" : template,
    meta: {
      name: base?.name || "",
      version: base ? bumpPatch(base.version) : "0.1.0",
      description: base?.description || "",
      category: base?.manifest?.spec?.category || "",
      license: "",
    },
    component: { name: "", target: "src/modules/{component}", language: "" },
    skill: "mi-skill",
    files: new Map(),
    dependencies: { ...(base?.manifest?.spec?.dependencies ?? {}) },
    features: {},
    manifestText: "",
    manifestDirty: Boolean(base),
    starter: new Set(),
    editing: null,
    folderEdit: null,
  };
}

async function loadBaseFiles(s, base) {
  const artifact = await get(`/artifacts/${encodeURIComponent(base.artifactId)}`);
  for (const file of artifact.files) s.files.set(file.path, { bytes: base64ToBytes(file.content) });
  s.manifestText = JSON.stringify(base.manifest, null, 2);
}

async function publishableNamespaces(base) {
  if (base) return [];
  const publish = state.permissions?.publish || { all: false, namespaces: [] };
  return publish.all ? (await store.namespaces().catch(() => [])).map((n) => n.name) : publish.namespaces;
}

function splitName(name) {
  const value = String(name || "");
  return value.split("/").length === 2 ? value.split("/") : ["", value];
}

function editorForm(ctx) {
  return html`<form class="stack wizard" novalidate>
      ${typeStep(ctx)}
      ${identityStep(ctx)}
      ${filesStep()}
      ${optionsStep(ctx)}
      ${dependenciesStep()}
      ${reviewStep(ctx)}
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${icon("package")}Publicar</button></div>
    </form>`;
}

function editorDialog(ctx) {
  const { base } = ctx;
  return openDialog({
    title: base ? `Nueva versión de ${base.name}` : "Crear paquete",
    description: base
      ? `Parte de la versión ${base.version}. Las versiones publicadas son inmutables: esto publica una versión nueva.`
      : "Elige qué quieres compartir, añade los archivos y publícalo en este servidor.",
    size: "lg",
    body: editorForm(ctx),
  });
}

function attachHelpers(ctx) {
  const { form } = ctx;
  ctx.$ = (id) => form.querySelector(`#${id}`);
  ctx.showError = (error) => {
    const box = form.querySelector(".form-error");
    box.textContent = error.message;
    box.hidden = false;
  };
  ctx.clearError = () => {
    form.querySelector(".form-error").hidden = true;
  };
  ctx.pkgFullName = () => `${ctx.$("pkgNamespace").value.trim()}/${ctx.$("pkgName").value.trim()}`;
  ctx.readForm = () => readForm(ctx);
  ctx.currentManifest = () => currentManifest(ctx);
  ctx.syncManifest = () => syncManifest(ctx);
  ctx.loadStarter = () => loadStarter(ctx);
  ctx.drawTemplateFields = () => drawTemplateFields(ctx);
  ctx.applyKind = () => applyKind(ctx);
  ctx.refresh = () => {
    drawFiles(ctx);
    drawEditor(ctx);
    ctx.syncManifest();
  };
}

function bindFormInput(ctx) {
  const { s, form } = ctx;
  form.addEventListener("input", (event) => {
    const target = event.target;
    if (target.id === "pkgManifest") {
      s.manifestDirty = true;
      return;
    }
    if (["editPath", "editContent"].includes(target.id) || target.type === "file") return;
    if (target.closest("#depList, #featureEditor")) return;
    if (target.id === "compName" || target.id === "skillName") {
      ctx.readForm();
      if (untouchedStarter(s)) {
        ctx.loadStarter();
        drawFiles(ctx);
      }
    }
    ctx.syncManifest();
  });
}

function startWizard(ctx) {
  const { s, form } = ctx;
  return wizard(form, {
    skip: { files: () => s.template === "profile", features: () => skipOptions(ctx) },
    validate: {
      type: () => validateType(ctx),
      identity: () => validateIdentity(ctx),
      files: () => validateFiles(ctx),
      features: () => ctx.features.issue([...s.files.keys()]),
      dependencies: () => validateDependencies(ctx),
    },
    onEnter: {
      features: () => ctx.features.refresh(),
      review: () => {
        ctx.readForm();
        ctx.syncManifest();
        form.querySelector('[data-action="validate"]').click();
      },
    },
  });
}

export async function openPackageEditor({ base, template = "component", onPublished } = {}) {
  const s = initialState(base, template);
  if (base) {
    try {
      await loadBaseFiles(s, base);
    } catch (error) {
      return toastError(error);
    }
  }
  const pkgNamespaces = await publishableNamespaces(base);
  const categories = await get("/categories")
    .then((result) => result.categories)
    .catch(() => []);
  const [pkgScope, pkgShort = ""] = splitName(s.meta.name);
  const ctx = { s, base, onPublished, categories, pkgNamespaces, pkgScope, pkgShort, steps: null };
  ctx.baseComponents = base?.manifest?.spec?.contributes?.components ?? [];
  ctx.form = editorDialog(ctx).querySelector("form");
  bindNamespaceSearch(ctx.form, "pkgNamespace", pkgNamespaces);
  attachHelpers(ctx);
  ctx.deps = createDependencies(ctx);
  ctx.features = createFeatures(ctx);
  ctx.versionCheck = bindVersionCheck({
    name: ctx.pkgFullName,
    input: ctx.$("pkgVersion"),
    hint: ctx.$("pkgVersionHint"),
    fetchVersions: async (name) =>
      (await get(`/packages?includeYanked=true&name=${encodeURIComponent(name)}`)).packages.map((item) => item.version),
    watch: [ctx.$("pkgNamespace"), ctx.$("pkgName")],
  });
  bindTypeStep(ctx);
  bindFormInput(ctx);
  bindUploads(ctx);
  ctx.form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  delegate(ctx.form, {
    ...fileActions(ctx),
    regenerate: () => {
      s.manifestDirty = false;
      ctx.syncManifest();
    },
    addDependency: () => ctx.deps.add(),
    validate: (button) => validatePackage(ctx, button),
  });
  ctx.steps = startWizard(ctx);
  bindPublish(ctx);
  ctx.loadStarter();
  ctx.drawTemplateFields();
  ctx.applyKind();
  ctx.refresh();
}
