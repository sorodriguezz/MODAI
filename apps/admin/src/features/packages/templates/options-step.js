import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { featureEditor } from "../../../shared/pickers/feature-editor/feature-editor.js";
import { TEMPLATE_MANIFEST } from "../detail/template-usage.js";
import { foldersOf } from "./template-common.js";

const ADDON_TARGET = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

export function optionsStep({ declared }) {
  return html`<section data-step="options" data-title="Opciones"><div class="stack">
        <p class="hint">Opciones que quien crea el proyecto activa con <code>modai template use @equipo/template --nombre</code> (y <code>--no-nombre</code> quita una activada por defecto). Cada una puede copiar una carpeta sobre el proyecto, rellenar marcadores y añadir paquetes MODAI a su <code>modai.yaml</code>. Se guardan en <code>${TEMPLATE_MANIFEST}</code>.</p>
        <p class="callout tone-info" id="tplZipNotice" hidden>${icon("info")}<span>Si tu .zip ya trae <code>${TEMPLATE_MANIFEST}</code>, se respeta mientras no cambies nada aquí. Si añades o editas opciones, estas lo reemplazan.</span></p>
        <div id="tplFeatures"></div>
        <fieldset class="field"><legend>Add-on</legend>
          <label class="check-inline"><input type="checkbox" id="tplAddon" ${declared.addon ? "checked" : ""}> Este template es una capa para combinar con otros (<code>--with</code>)</label>
          <div class="field" id="tplAddonForField" ${declared.addon ? "" : "hidden"}><label for="tplAddonFor">Para qué templates (vacío: cualquiera)</label><input id="tplAddonFor" value="${(declared.addon?.for || []).join(", ")}" placeholder="@equipo/springboot, @equipo/nestjs" spellcheck="false"></div>
        </fieldset>
      </div></section>`;
}

export function createTemplateFeatures(ctx) {
  return featureEditor(ctx.form.querySelector("#tplFeatures"), {
    id: "tplOpt",
    mode: "template",
    initial: ctx.declared.features,
    exclude: ctx.name,
    folders: () => {
      const paths = ctx.knownPaths();
      return paths ? foldersOf(paths) : [];
    },
  });
}

const addonFor = (form) =>
  form.tplAddonFor.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export function declaration(ctx) {
  const { form } = ctx;
  if (!ctx.features.touched && !ctx.addonTouched) return undefined;
  return {
    features: ctx.features.templateFeatures(),
    ...(form.tplAddon.checked ? { addon: { for: addonFor(form) } } : {}),
  };
}

export function bindAddon(ctx) {
  ctx.form.querySelector("#tplAddonFor").addEventListener("input", () => {
    ctx.addonTouched = true;
  });
}

export function handleAddonChange(ctx, target) {
  if (target.id !== "tplAddon") return;
  ctx.addonTouched = true;
  ctx.form.querySelector("#tplAddonForField").hidden = !target.checked;
}

export function validateOptions(ctx) {
  const { form } = ctx;
  const issue = ctx.features.issue(ctx.knownPaths());
  if (issue) return issue;
  return form.tplAddon.checked && addonFor(form).some((item) => !ADDON_TARGET.test(item))
    ? "Cada template del add-on es @namespace/nombre."
    : "";
}

export function enterOptions(ctx) {
  ctx.form.querySelector("#tplZipNotice").hidden = ctx.source() !== "zip";
  ctx.features.refresh();
}
