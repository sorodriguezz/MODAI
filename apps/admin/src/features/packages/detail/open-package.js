import { can, store } from "../../../app/state.js";
import { get } from "../../../shared/lib/api.js";
import { delegate, html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { describeManifest } from "../../../shared/lib/manifest.js";
import { qualityPanel } from "../../../shared/lib/quality.js";
import { bindFeaturePicker, featureList } from "../../../shared/pickers/feature-picker.js";
import { codeBlock } from "../../../shared/ui/code-block.js";
import { closeDialog, openDialog } from "../../../shared/ui/dialog.js";
import { bindTabs } from "../../../shared/ui/tabs.js";
import { toast, toastError } from "../../../shared/ui/toast.js";
import { collectAgents, openAgent } from "../agents/agent-dialog.js";
import { openPackageEditor } from "../editor/package-editor.js";
import { openTemplateEditor } from "../templates/template-editor.js";
import { loadFiles, showFile } from "./files-panel.js";
import { installCommand, overviewPanel } from "./overview-panel.js";
import { templateOverviewPanel } from "./template-overview.js";
import { mountTemplateUsage } from "./template-usage.js";
import { loadUsage } from "./usage-panel.js";
import { versionActions, versionsPanel } from "./versions-panel.js";

function detailBody({ item, info, versions, template }) {
  return html`<div class="tabs" role="tablist" aria-label="Detalle del paquete">
        <button role="tab" type="button" data-tab="overview" aria-selected="true">Resumen</button>
        <button role="tab" type="button" data-tab="versions" aria-selected="false" tabindex="-1">Versiones <span class="count">${versions.length}</span></button>
        <button role="tab" type="button" data-tab="files" aria-selected="false" tabindex="-1">Archivos</button>
        ${template ? "" : html`<button role="tab" type="button" data-tab="usage" aria-selected="false" tabindex="-1">Proyectos</button>`}
        <button role="tab" type="button" data-tab="quality" aria-selected="false" tabindex="-1">Calidad</button>
        <button role="tab" type="button" data-tab="manifest" aria-selected="false" tabindex="-1">Manifiesto</button>
      </div>
      <div role="tabpanel" data-panel="overview" class="tab-panel">${template ? templateOverviewPanel(item, info) : overviewPanel(item, info)}</div>
      <div role="tabpanel" data-panel="versions" class="tab-panel" hidden>${versionsPanel(versions)}</div>
      <div role="tabpanel" data-panel="files" class="tab-panel" hidden><div id="packageFiles">${html`<p class="muted small">Cargando archivos…</p>`}</div></div>
      <div role="tabpanel" data-panel="usage" class="tab-panel" hidden><div id="packageUsage">${html`<p class="muted small">Cargando proyectos…</p>`}</div></div>
      <div role="tabpanel" data-panel="quality" class="tab-panel" hidden>${qualityPanel(item.quality)}</div>
      ${can.publish() ? html`<div class="dialog-actions"><button type="button" class="btn" data-action="newVersion">${icon("edit")}Editar y publicar nueva versión</button></div>` : ""}
      <div role="tabpanel" data-panel="manifest" class="tab-panel" hidden>${codeBlock("manifestJson", JSON.stringify(item.manifest, null, 2), "Copiar JSON")}</div>`;
}

async function loadVersions(name) {
  return (await get(`/packages?includeYanked=true&name=${encodeURIComponent(name)}`)).packages.sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
  );
}

function bindLazyTabs(body, { item, name, versions }) {
  const loaded = { files: null, usage: false };
  bindTabs(body, async (tab) => {
    if (tab === "usage" && !loaded.usage) {
      loaded.usage = true;
      await loadUsage(body, name, versions[0]);
      return;
    }
    if (tab !== "files" || loaded.files) return;
    loaded.files = await loadFiles(body, item);
  });
  return loaded;
}

async function useAgent(item, index) {
  const entry = collectAgents([item])[index];
  const projects = await store.projects().catch(() => []);
  openAgent(entry, projects, (id, { params } = {}) => {
    history.pushState(null, "", `#/${id}${params ? `?${new URLSearchParams(params)}` : ""}`);
    dispatchEvent(new PopStateEvent("popstate"));
  });
}

export async function openPackage(name, version, onChange, onPublished = onChange) {
  let versions;
  try {
    versions = await loadVersions(name);
  } catch (error) {
    return toastError(error);
  }
  const item = versions.find((entry) => entry.version === version) || versions[0];
  if (!item) return toastError(new Error("El paquete ya no existe."));
  const info = describeManifest(item);
  const template = info.kind === "Template";
  const body = openDialog({
    title: item.name,
    description: `Versión ${item.version} · ${info.category}${info.kind ? ` · ${info.kind}` : ""}`,
    size: "lg",
    body: detailBody({ item, info, versions, template }),
  });
  if (template) mountTemplateUsage(body.querySelector("#templateUsage"), item);
  bindFeaturePicker(body, "packageFeatures", featureList(item.manifest?.spec?.features), (flags) => {
    const code = body.querySelector("#installCommand");
    if (code) code.textContent = installCommand(item, info, flags);
  });
  const loaded = bindLazyTabs(body, { item, name, versions });
  const changed = async (message) => {
    toast(message);
    closeDialog();
    await onChange?.();
  };
  delegate(body, {
    showFile: (button) => {
      const file = loaded.files?.find((entry) => entry.path === button.dataset.path);
      if (file) showFile(body, file);
    },
    newVersion: () =>
      template ? openTemplateEditor({ base: item, onPublished }) : openPackageEditor({ base: item, onPublished }),
    useAgent: (button) => useAgent(item, Number(button.dataset.index)),
    ...versionActions(name, changed),
  });
}
