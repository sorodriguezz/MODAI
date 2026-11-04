import { html } from "../lib/html.js";

const CONTRIBUTION_LABELS = {
  skills: "skill(s)",
  rules: "regla(s)",
  knowledge: "documento(s)",
  tools: "herramienta(s)",
  mcpServers: "servidor(es) MCP",
  components: "componente(s)",
  files: "archivo(s)",
};

function withInitial(result) {
  const byName = new Map(result.map((f) => [f.name, f]));
  const on = new Set();
  const add = (name) => {
    if (on.has(name) || !byName.has(name)) return;
    on.add(name);
    for (const required of byName.get(name).requires) add(required);
  };
  for (const f of result) if (f.default) add(f.name);
  for (const f of result) f.initial = on.has(f.name);
  return result;
}

export function featureList(features) {
  if (!features) return [];
  const list = Array.isArray(features)
    ? features
    : Object.entries(features).map(([name, feature]) => ({ name, ...feature }));
  return withInitial(
    list.map((feature) => ({
      name: feature.name,
      description: feature.description || "",
      default: Boolean(feature.default),
      requires: feature.requires || [],
      conflicts: feature.conflicts || [],
      notes: featureNotes(feature),
    })),
  );
}

function featureNotes(feature) {
  const notes = [];
  const contributes = Object.entries(feature.contributes || {}).filter(([, list]) => list?.length);
  if (contributes.length)
    notes.push(
      `añade ${contributes.map(([key, list]) => `${list.length} ${CONTRIBUTION_LABELS[key] || key}`).join(", ")}`,
    );
  if (feature.overlays?.length)
    notes.push(`modifica ${[...new Set(feature.overlays.map((overlay) => overlay.component))].join(", ")}`);
  const packages = Object.keys(feature.dependencies || feature.packages || {});
  if (packages.length) notes.push(`instala ${packages.join(", ")}`);
  if (feature.uses) notes.push(`usa ${feature.uses}`);
  return notes;
}

function featureDetails(f) {
  const requires = f.requires.length ? ` · requiere ${f.requires.join(", ")}` : "";
  const conflicts = f.conflicts.length ? ` · no combina con ${f.conflicts.join(", ")}` : "";
  const notes = f.notes.length ? ` · ${f.notes.join(" · ")}` : "";
  return `${f.description}${requires}${conflicts}${notes}`;
}

const featureOption = (f) =>
  html`<label class="role-option"><input type="checkbox" data-feature="${f.name}" ${f.initial ? "checked" : ""}><span><b><code>--${f.name}</code></b>${f.default ? html` <span class="badge">por defecto</span>` : ""}<span class="muted small">${featureDetails(f)}</span></span></label>`;

export function featurePicker(id, features, hint) {
  if (!features.length) return "";
  return html`<fieldset class="field"><legend>Opciones (features)</legend><div class="role-options" id="${id}">${features.map(featureOption)}</div><p class="hint">${hint}</p></fieldset>`;
}

function flagOf(f, checked) {
  if (checked === f.initial) return "";
  return checked ? `--${f.name}` : `--no-${f.name}`;
}

export function bindFeaturePicker(root, id, features, onChange) {
  const container = root.querySelector(`#${id}`);
  if (!container) return;
  const box = (name) => container.querySelector(`[data-feature="${name}"]`);
  const byName = new Map(features.map((f) => [f.name, f]));
  const uncheckDependents = (name) => {
    for (const f of features) if (f.requires.includes(name)) uncheck(f.name);
  };
  const check = (name, seen = new Set()) => {
    if (seen.has(name)) return;
    seen.add(name);
    box(name).checked = true;
    for (const required of byName.get(name).requires) check(required, seen);
    for (const other of byName.get(name).conflicts) uncheck(other);
    for (const f of features) if (f.conflicts.includes(name)) uncheck(f.name);
  };
  function uncheck(name) {
    if (!box(name).checked) return;
    box(name).checked = false;
    uncheckDependents(name);
  }
  container.addEventListener("change", (event) => {
    const name = event.target?.dataset?.feature;
    if (!name) return;
    if (event.target.checked) check(name);
    else uncheckDependents(name);
    onChange(features.map((f) => flagOf(f, box(f.name).checked)).filter(Boolean));
  });
}
