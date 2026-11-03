// Feature (flag) editor shared by the package editor (spec.features of a component package) and the template
// editor (modai.template.yaml). A feature is an option the person switches on at install time: `--name` turns it on,
// `--no-name` turns a default one off. It can add a folder of files, packages and (templates) {{markers}} values.
import { html, mount } from "./html.js";
import { icon } from "./icons.js";
import { dependencyPicker } from "./dependency-picker.js";

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const EDITED = ["description", "default", "requires", "conflicts", "dependencies", "overlays", "path", "packages", "vars", "uses"];

/** Template features (a list from GET /packages/template) or package features (a map) to the editor's shape. */
function normalize(initial, mode) {
  const list = Array.isArray(initial) ? initial : Object.entries(initial || {}).map(([name, feature]) => ({ name, ...feature }));
  return list.map((feature) => {
    const extra = Object.fromEntries(Object.entries(feature).filter(([key]) => key !== "name" && !EDITED.includes(key)));
    if (mode === "package" && feature.overlays?.length > 1) extra.overlays = feature.overlays.slice(1);
    const packages = mode === "template"
      ? Object.fromEntries(Object.entries(feature.packages || {}).map(([name, spec]) => [name, typeof spec === "string" ? spec : spec.version]))
      : { ...(feature.dependencies || {}) };
    return {
      name: feature.name, description: feature.description || "", default: Boolean(feature.default),
      requires: [...(feature.requires || [])], conflicts: [...(feature.conflicts || [])],
      folder: mode === "template" ? feature.path || "" : feature.overlays?.[0]?.path || "",
      component: feature.overlays?.[0]?.component || "",
      packageFeatures: mode === "template" ? Object.fromEntries(Object.entries(feature.packages || {}).filter(([, spec]) => typeof spec === "object" && spec.features?.length).map(([name, spec]) => [name, spec.features])) : {},
      initialPackages: packages,
      vars: Object.entries(feature.vars || {}).map(([key, value]) => `${key}=${value}`).join("\n"),
      uses: feature.uses || "", extra,
    };
  });
}

/**
 * @param {HTMLElement} container
 * @param {{ id: string, mode: "template" | "package", initial?: unknown, folders?: () => string[] | null, exclude?: () => string, onChange?: () => void }} options
 *   `folders()` lists the folders the files step has (null when unknown, for a .zip); `exclude()` is the package itself.
 */
export function featureEditor(container, { id, mode, initial, folders = () => null, exclude = () => "", onChange = () => {} }) {
  const features = normalize(initial, mode);
  let counter = 0;
  let touched = false;
  const changed = () => { touched = true; onChange(); };

  mount(container, html`<div class="stack">
    <div class="feature-list stack" data-feature-list></div>
    <p class="muted small" data-feature-empty>Sin opciones: se instala siempre igual.</p>
    <div><button type="button" class="btn small" data-feature-add>${icon("plus", 16)}Añadir opción</button></div>
    <datalist id="${id}Folders"></datalist>
  </div>`);
  const list = container.querySelector("[data-feature-list]");
  const empty = container.querySelector("[data-feature-empty]");

  const relations = (feature, field) => {
    const others = features.filter((other) => other !== feature && other.name);
    return others.length
      ? others.map((other) => html`<label class="check-chip"><input type="checkbox" data-feature-${field} value="${other.name}" ${feature[field].includes(other.name) ? "checked" : ""}><span>--${other.name}</span></label>`)
      : html`<span class="muted small">No hay otras opciones.</span>`;
  };
  const refreshRelations = () => {
    for (const feature of features) {
      if (!feature.card) continue;
      // Drop references to features that were renamed or removed.
      const names = new Set(features.map((item) => item.name));
      feature.requires = feature.requires.filter((name) => names.has(name));
      feature.conflicts = feature.conflicts.filter((name) => names.has(name));
      mount(feature.card.querySelector("[data-zone=requires]"), relations(feature, "requires"));
      mount(feature.card.querySelector("[data-zone=conflicts]"), relations(feature, "conflicts"));
      feature.card.querySelector("[data-feature-title]").textContent = feature.name ? "--" + feature.name : "Opción nueva";
    }
    empty.hidden = features.length > 0;
    mount(container.querySelector(`#${id}Folders`), (folders() || []).map((folder) => html`<option value="${folder}"></option>`));
  };

  const card = (feature) => {
    const key = `${id}F${++counter}`;
    const element = document.createElement("div");
    element.className = "feature-card";
    mount(element, html`
      <div class="feature-head"><b data-feature-title></b>
        <label class="check-inline"><input type="checkbox" data-feature-default ${feature.default ? "checked" : ""}> Activada por defecto</label>
        <button type="button" class="icon-button small danger" data-feature-remove aria-label="Quitar la opción ${feature.name || "nueva"}">${icon("trash", 16)}</button></div>
      <div class="field-row">
        <div class="field"><label for="${key}Name">Nombre de la opción</label><input id="${key}Name" data-feature-name value="${feature.name}" placeholder="sdd" pattern="[a-z][a-z0-9\\-]{0,39}" spellcheck="false" autocapitalize="off"><p class="hint">Se activa con <code>--nombre</code>.</p></div>
        <div class="field"><label for="${key}Description">Qué hace</label><input id="${key}Description" data-feature-description value="${feature.description}" maxlength="500" placeholder="Añade Spec-Driven Development (specs/ y plantillas)"><p class="hint">Es lo que se ve en <code>--help</code>.</p></div>
      </div>
      <div class="field"><label for="${key}Folder">Carpeta con sus archivos (opcional)</label><input id="${key}Folder" data-feature-folder list="${id}Folders" value="${feature.folder}" placeholder="features/sdd" spellcheck="false">
        <p class="hint">${mode === "template"
          ? html`Sus archivos se copian sobre la raíz del proyecto nuevo (reemplazan los del template base). Créala en el paso <b>Archivos</b>.`
          : html`Sus archivos se añaden al componente (o reemplazan los suyos) cuando la opción está activa. Créala en el paso <b>Archivos</b>.`}</p></div>
      <div class="field-row">
        <fieldset class="field"><legend>Activa también</legend><div class="check-chips" data-zone="requires"></div></fieldset>
        <fieldset class="field"><legend>Incompatible con</legend><div class="check-chips" data-zone="conflicts"></div></fieldset>
      </div>
      ${mode === "template" ? html`<div class="field-row">
        <div class="field"><label for="${key}Vars">Valores de marcadores</label><textarea id="${key}Vars" data-feature-vars rows="2" class="mono" placeholder="specsDir=specs" spellcheck="false">${feature.vars}</textarea><p class="hint">Uno por línea, <code>clave=valor</code>: rellenan <code>{{clave}}</code> mientras la opción está activa.</p></div>
        <div class="field"><label for="${key}Uses">Add-on que aplica (opcional)</label><input id="${key}Uses" data-feature-uses value="${feature.uses}" placeholder="@equipo/sdd-addon@1.0.0" spellcheck="false"><p class="hint">Otro template que se combina antes de esta carpeta.</p></div>
      </div>` : ""}
      <div class="field"><span class="label">${mode === "template" ? "Paquetes MODAI que añade al modai.yaml del proyecto" : "Paquetes que instala además"}</span>
        <div class="stack" data-feature-deps></div>
        <div><button type="button" class="btn small ghost" data-feature-dep-add>${icon("plus", 16)}Añadir paquete</button></div></div>`);
    feature.card = element;
    feature.picker = dependencyPicker(element.querySelector("[data-feature-deps]"), { id: key + "Dep", initial: feature.initialPackages, exclude, emptyText: () => "Ninguno.", onChange: changed });
    return element;
  };

  const featureOf = (element) => features.find((feature) => feature.card === element.closest(".feature-card"));
  container.addEventListener("input", (event) => {
    const feature = featureOf(event.target);
    if (!feature || event.target.closest("[data-feature-deps]")) return;
    if (event.target.matches("[data-feature-name]")) { feature.name = event.target.value.trim(); refreshRelations(); }
    else if (event.target.matches("[data-feature-description]")) feature.description = event.target.value;
    else if (event.target.matches("[data-feature-folder]")) feature.folder = event.target.value.trim().replace(/\/+$/, "");
    else if (event.target.matches("[data-feature-vars]")) feature.vars = event.target.value;
    else if (event.target.matches("[data-feature-uses]")) feature.uses = event.target.value.trim();
    else return;
    changed();
  });
  container.addEventListener("change", (event) => {
    const feature = featureOf(event.target);
    if (!feature || event.target.closest("[data-feature-deps]")) return;
    if (event.target.matches("[data-feature-default]")) feature.default = event.target.checked;
    else if (event.target.matches("[data-feature-requires], [data-feature-conflicts]")) {
      const field = event.target.matches("[data-feature-requires]") ? "requires" : "conflicts";
      feature[field] = event.target.checked ? [...new Set([...feature[field], event.target.value])] : feature[field].filter((name) => name !== event.target.value);
    } else return;
    changed();
  });
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-feature-add]")) {
      const feature = normalize([{ name: "" }], mode)[0];
      features.push(feature);
      list.append(card(feature));
      refreshRelations();
      feature.card.querySelector("[data-feature-name]").focus();
      changed();
    } else if (event.target.closest("[data-feature-dep-add]")) featureOf(event.target)?.picker.add();
    else if (event.target.closest("[data-feature-remove]")) {
      const feature = featureOf(event.target);
      features.splice(features.indexOf(feature), 1);
      feature.card.remove();
      refreshRelations();
      changed();
    }
  });

  for (const feature of features) list.append(card(feature));
  refreshRelations();

  const vars = (text) => Object.fromEntries(text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
  return {
    get touched() { return touched; },
    get size() { return features.length; },
    /** Redraws the folder suggestions (after the files step changed). */
    refresh: refreshRelations,
    /** What blocks the step, or "". `paths` (when known) checks that each folder has files. */
    issue(paths) {
      const names = features.map((feature) => feature.name);
      for (const feature of features) {
        const label = feature.name ? "--" + feature.name : "Una opción nueva";
        if (!NAME.test(feature.name)) return `${label}: el nombre usa minúsculas, números y guiones, empezando por letra (máx. 40).`;
        if (names.filter((name) => name === feature.name).length > 1) return `Hay dos opciones llamadas --${feature.name}.`;
        if (!feature.description.trim()) return `${label}: describe qué hace (es lo que se ve en --help).`;
        if (feature.requires.some((name) => feature.conflicts.includes(name))) return `${label}: no puede activar y ser incompatible con la misma opción.`;
        if (feature.vars.split("\n").some((line) => line.trim() && !/^[A-Za-z][\w-]*\s*=/.test(line.trim()))) return `${label}: cada marcador va como clave=valor, uno por línea.`;
        if (feature.uses && !/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(@[^\s@]+)?$/.test(feature.uses)) return `${label}: el add-on es @namespace/nombre[@versión].`;
        if (feature.folder && paths && !paths.some((path) => path.startsWith(feature.folder + "/"))) return `${label}: la carpeta ${feature.folder} no tiene archivos. Créala en el paso Archivos o deja el campo vacío.`;
        const doesSomething = feature.folder || feature.uses || feature.vars.trim() || feature.requires.length || feature.picker.size || (mode === "package" && Object.keys(feature.extra.contributes || {}).length);
        if (!doesSomething) return `${label} no hace nada: indica una carpeta, paquetes, otras opciones que activa${mode === "template" ? ", marcadores o un add-on" : ""}.`;
        const problem = feature.picker.issue();
        if (problem) return `${label}: ${problem}`;
      }
      return "";
    },
    /** modai.template.yaml `features` map. */
    templateFeatures() {
      return Object.fromEntries(features.map((feature) => [feature.name, {
        description: feature.description.trim(),
        ...(feature.folder ? { path: feature.folder } : {}),
        ...(feature.default ? { default: true } : {}),
        ...(feature.requires.length ? { requires: feature.requires } : {}),
        ...(feature.conflicts.length ? { conflicts: feature.conflicts } : {}),
        ...(feature.uses ? { uses: feature.uses } : {}),
        ...(feature.vars.trim() ? { vars: vars(feature.vars) } : {}),
        ...(feature.picker.size ? { packages: Object.fromEntries(Object.entries(feature.picker.value).map(([name, range]) => [name, feature.packageFeatures[name] ? { version: range, features: feature.packageFeatures[name] } : range])) } : {}),
      }]));
    },
    /** spec.features map of a package; overlays go onto `component` (the package's component). */
    packageFeatures(component) {
      return Object.fromEntries(features.map((feature) => [feature.name, {
        ...feature.extra,
        description: feature.description.trim(), default: feature.default, requires: feature.requires, conflicts: feature.conflicts,
        dependencies: feature.picker.value,
        overlays: [...(feature.folder ? [{ component: feature.component || component, path: feature.folder }] : []), ...(feature.extra.overlays || [])],
      }]));
    },
  };
}
