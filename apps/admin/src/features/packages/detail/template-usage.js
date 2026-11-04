import { get } from "../../../shared/lib/api.js";
import { html, mount } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { bindFeaturePicker, featureList, featurePicker } from "../../../shared/pickers/feature-picker.js";
import { codeBlock } from "../../../shared/ui/code-block.js";
import { errorState } from "../../../shared/ui/empty-state.js";

export const TEMPLATE_MANIFEST = "modai.template.yaml";

export const templateDownloadUrl = (name, version) =>
  `/api/v1/packages/download?name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`;

export const useCommand = (name, version, flags = []) =>
  `modai template use ${name}@${version} ./mi-proyecto${flags.length ? ` ${flags.join(" ")}` : ""} --var projectName=mi-proyecto`;

export const templateInfo = (name, version) =>
  get(`/packages/template?name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`);

function manifestError(info) {
  if (!info.manifestError) return "";
  return html`<div class="callout tone-warning">${icon("alert")}<span><b>${TEMPLATE_MANIFEST} no es válido:</b> ${info.manifestError}</span></div>`;
}

function addonCallout(info, item) {
  if (!info.addon) return "";
  return html`<div class="callout tone-info">${icon("info")}<span>Es un <b>add-on</b>${info.addon.for.length ? ` para ${info.addon.for.join(", ")}` : ""}: se combina con otro template usando <code>--with ${item.name}</code>.</span></div>`;
}

export async function mountTemplateUsage(container, item) {
  let info;
  try {
    info = await templateInfo(item.name, item.version);
  } catch (error) {
    return mount(container, errorState(error));
  }
  const features = featureList(info.features);
  mount(
    container,
    html`
    ${manifestError(info)}
    <h4>Crear un proyecto</h4>
    ${featurePicker("tplUseFeatures", features, html`Marca lo que quieres y el comando se arma solo. En la CLI: <code>modai template use ${item.name} --help</code>.`)}
    ${addonCallout(info, item)}
    ${codeBlock("tplUseCommand", useCommand(item.name, item.version), "Copiar")}
    <div class="row-actions"><a class="btn" href="${templateDownloadUrl(item.name, item.version)}" download>${icon("download")}Descargar .zip</a></div>
    <p class="hint">${info.files.length} archivos. Un template no se instala con <code>modai add</code>: crea un proyecto nuevo.</p>`,
  );
  bindFeaturePicker(container, "tplUseFeatures", features, (flags) => {
    const code = container.querySelector("#tplUseCommand");
    if (code) code.textContent = useCommand(item.name, item.version, flags);
  });
}
