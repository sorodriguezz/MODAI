import { html, mount } from "../../lib/html.js";
import { icon } from "../../lib/icons.js";
import { dependencyPicker } from "../dependency-picker.js";
import { featureCardMarkup, relationsMarkup } from "./feature-card.js";
import { featuresIssue } from "./feature-issues.js";
import { packageFeatures, templateFeatures } from "./feature-output.js";
import { normalize } from "./normalize.js";

const INPUT_FIELDS = [
  [
    "[data-feature-name]",
    (feature, value, refresh) => {
      feature.name = value.trim();
      refresh();
    },
  ],
  [
    "[data-feature-description]",
    (feature, value) => {
      feature.description = value;
    },
  ],
  [
    "[data-feature-folder]",
    (feature, value) => {
      feature.folder = value.trim().replace(/\/+$/, "");
    },
  ],
  [
    "[data-feature-vars]",
    (feature, value) => {
      feature.vars = value;
    },
  ],
  [
    "[data-feature-uses]",
    (feature, value) => {
      feature.uses = value.trim();
    },
  ],
];

function toggleRelation(feature, target) {
  const field = target.matches("[data-feature-requires]") ? "requires" : "conflicts";
  feature[field] = target.checked
    ? [...new Set([...feature[field], target.value])]
    : feature[field].filter((name) => name !== target.value);
}

function bindInputs(container, featureOf, refresh, changed) {
  container.addEventListener("input", (event) => {
    const feature = featureOf(event.target);
    if (!feature || event.target.closest("[data-feature-deps]")) return;
    const entry = INPUT_FIELDS.find(([selector]) => event.target.matches(selector));
    if (!entry) return;
    entry[1](feature, event.target.value, refresh);
    changed();
  });
  container.addEventListener("change", (event) => {
    const feature = featureOf(event.target);
    if (!feature || event.target.closest("[data-feature-deps]")) return;
    if (event.target.matches("[data-feature-default]")) feature.default = event.target.checked;
    else if (event.target.matches("[data-feature-requires], [data-feature-conflicts]"))
      toggleRelation(feature, event.target);
    else return;
    changed();
  });
}

export function featureEditor(
  container,
  { id, mode, initial, folders = () => null, exclude = () => "", onChange = () => {} },
) {
  const features = normalize(initial, mode);
  let counter = 0;
  let touched = false;
  const changed = () => {
    touched = true;
    onChange();
  };
  mount(
    container,
    html`<div class="stack">
    <div class="feature-list stack" data-feature-list></div>
    <p class="muted small" data-feature-empty>Sin opciones: se instala siempre igual.</p>
    <div><button type="button" class="btn small" data-feature-add>${icon("plus", 16)}Añadir opción</button></div>
    <datalist id="${id}Folders"></datalist>
  </div>`,
  );
  const list = container.querySelector("[data-feature-list]");
  const empty = container.querySelector("[data-feature-empty]");
  const refreshCard = (feature, names) => {
    feature.requires = feature.requires.filter((name) => names.has(name));
    feature.conflicts = feature.conflicts.filter((name) => names.has(name));
    mount(feature.card.querySelector("[data-zone=requires]"), relationsMarkup(features, feature, "requires"));
    mount(feature.card.querySelector("[data-zone=conflicts]"), relationsMarkup(features, feature, "conflicts"));
    feature.card.querySelector("[data-feature-title]").textContent = feature.name
      ? `--${feature.name}`
      : "Opción nueva";
  };
  const refresh = () => {
    for (const feature of features) if (feature.card) refreshCard(feature, new Set(features.map((item) => item.name)));
    empty.hidden = features.length > 0;
    mount(
      container.querySelector(`#${id}Folders`),
      (folders() || []).map((folder) => html`<option value="${folder}"></option>`),
    );
  };
  const card = (feature) => {
    const key = `${id}F${++counter}`;
    const element = document.createElement("div");
    element.className = "feature-card";
    mount(element, featureCardMarkup({ id, key, mode, feature }));
    feature.card = element;
    feature.picker = dependencyPicker(element.querySelector("[data-feature-deps]"), {
      id: `${key}Dep`,
      initial: feature.initialPackages,
      exclude,
      emptyText: () => "Ninguno.",
      onChange: changed,
    });
    return element;
  };
  const featureOf = (element) => features.find((feature) => feature.card === element.closest(".feature-card"));
  bindInputs(container, featureOf, refresh, changed);
  const addFeature = () => {
    const feature = normalize([{ name: "" }], mode)[0];
    features.push(feature);
    list.append(card(feature));
    refresh();
    feature.card.querySelector("[data-feature-name]").focus();
    changed();
  };
  const removeFeature = (feature) => {
    features.splice(features.indexOf(feature), 1);
    feature.card.remove();
    refresh();
    changed();
  };
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-feature-add]")) addFeature();
    else if (event.target.closest("[data-feature-dep-add]")) featureOf(event.target)?.picker.add();
    else if (event.target.closest("[data-feature-remove]")) removeFeature(featureOf(event.target));
  });
  for (const feature of features) list.append(card(feature));
  refresh();
  return {
    get touched() {
      return touched;
    },
    get size() {
      return features.length;
    },
    refresh,
    issue: (paths) => featuresIssue(features, mode, paths),
    templateFeatures: () => templateFeatures(features),
    packageFeatures: (component) => packageFeatures(features, component),
  };
}
