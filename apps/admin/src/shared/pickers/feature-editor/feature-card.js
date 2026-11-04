import { html } from "../../lib/html.js";
import { icon } from "../../lib/icons.js";

export function relationsMarkup(features, feature, field) {
  const others = features.filter((other) => other !== feature && other.name);
  if (!others.length) return html`<span class="muted small">No hay otras opciones.</span>`;
  return others.map(
    (other) =>
      html`<label class="check-chip"><input type="checkbox" data-feature-${field} value="${other.name}" ${feature[field].includes(other.name) ? "checked" : ""}><span>--${other.name}</span></label>`,
  );
}

function folderHint(mode) {
  return mode === "template"
    ? html`Sus archivos se copian sobre la raíz del proyecto nuevo (reemplazan los del template base). Créala en el paso <b>Archivos</b>.`
    : html`Sus archivos se añaden al componente (o reemplazan los suyos) cuando la opción está activa. Créala en el paso <b>Archivos</b>.`;
}

function templateFields(mode, key, feature) {
  if (mode !== "template") return "";
  return html`<div class="field-row">
        <div class="field"><label for="${key}Vars">Valores de marcadores</label><textarea id="${key}Vars" data-feature-vars rows="2" class="mono" placeholder="specsDir=specs" spellcheck="false">${feature.vars}</textarea><p class="hint">Uno por línea, <code>clave=valor</code>: rellenan <code>{{clave}}</code> mientras la opción está activa.</p></div>
        <div class="field"><label for="${key}Uses">Add-on que aplica (opcional)</label><input id="${key}Uses" data-feature-uses value="${feature.uses}" placeholder="@equipo/sdd-addon@1.0.0" spellcheck="false"><p class="hint">Otro template que se combina antes de esta carpeta.</p></div>
      </div>`;
}

const packagesLabel = (mode) =>
  mode === "template" ? "Paquetes MODAI que añade al modai.yaml del proyecto" : "Paquetes que instala además";

export function featureCardMarkup({ id, key, mode, feature }) {
  return html`
      <div class="feature-head"><b data-feature-title></b>
        <label class="check-inline"><input type="checkbox" data-feature-default ${feature.default ? "checked" : ""}> Activada por defecto</label>
        <button type="button" class="icon-button small danger" data-feature-remove aria-label="Quitar la opción ${feature.name || "nueva"}">${icon("trash", 16)}</button></div>
      <div class="field-row">
        <div class="field"><label for="${key}Name">Nombre de la opción</label><input id="${key}Name" data-feature-name value="${feature.name}" placeholder="sdd" pattern="[a-z][a-z0-9\\-]{0,39}" spellcheck="false" autocapitalize="off"><p class="hint">Se activa con <code>--nombre</code>.</p></div>
        <div class="field"><label for="${key}Description">Qué hace</label><input id="${key}Description" data-feature-description value="${feature.description}" maxlength="500" placeholder="Añade Spec-Driven Development (specs/ y plantillas)"><p class="hint">Es lo que se ve en <code>--help</code>.</p></div>
      </div>
      <div class="field"><label for="${key}Folder">Carpeta con sus archivos (opcional)</label><input id="${key}Folder" data-feature-folder list="${id}Folders" value="${feature.folder}" placeholder="features/sdd" spellcheck="false">
        <p class="hint">${folderHint(mode)}</p></div>
      <div class="field-row">
        <fieldset class="field"><legend>Activa también</legend><div class="check-chips" data-zone="requires"></div></fieldset>
        <fieldset class="field"><legend>Incompatible con</legend><div class="check-chips" data-zone="conflicts"></div></fieldset>
      </div>
      ${templateFields(mode, key, feature)}
      <div class="field"><span class="label">${packagesLabel(mode)}</span>
        <div class="stack" data-feature-deps></div>
        <div><button type="button" class="btn small ghost" data-feature-dep-add>${icon("plus", 16)}Añadir paquete</button></div></div>`;
}
