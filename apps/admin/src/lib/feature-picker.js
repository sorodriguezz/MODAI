// Feature picker shared by the package and template details: every feature the author declared, as a checkbox, and
// the command line that results. Same rules as the CLI: --x switches a feature on, --no-x a default one off, and
// `requires` / `conflicts` are applied as the person clicks.
import { html } from "./html.js";

/** Normalises package features (a map in the manifest) and template features (a list) to one shape. */
export function featureList(features) {
  if (!features) return [];
  const list = Array.isArray(features) ? features : Object.entries(features).map(([name, feature]) => ({ name, ...feature }));
  const result = list.map((feature) => ({
    name: feature.name, description: feature.description || "", default: Boolean(feature.default),
    requires: feature.requires || [], conflicts: feature.conflicts || [], notes: featureNotes(feature),
  }));
  // What the CLI applies with no flags: the defaults and everything they require.
  const byName = new Map(result.map((f) => [f.name, f]));
  const on = new Set();
  const add = (name) => { if (on.has(name) || !byName.has(name)) return; on.add(name); for (const required of byName.get(name).requires) add(required); };
  for (const f of result) if (f.default) add(f.name);
  for (const f of result) f.initial = on.has(f.name);
  return result;
}

function featureNotes(feature) {
  const notes = [];
  const contributes = Object.entries(feature.contributes || {}).filter(([, list]) => list?.length);
  if (contributes.length) notes.push("añade " + contributes.map(([key, list]) => list.length + " " + ({ skills: "skill(s)", rules: "regla(s)", knowledge: "documento(s)", tools: "herramienta(s)", mcpServers: "servidor(es) MCP", components: "componente(s)", files: "archivo(s)" }[key] || key)).join(", "));
  if (feature.overlays?.length) notes.push("modifica " + [...new Set(feature.overlays.map((overlay) => overlay.component))].join(", "));
  const packages = Object.keys(feature.dependencies || feature.packages || {});
  if (packages.length) notes.push("instala " + packages.join(", "));
  if (feature.uses) notes.push("usa " + feature.uses);
  return notes;
}

/** The checkboxes. `id` names the container so several pickers can live in one page. */
export function featurePicker(id, features, hint) {
  if (!features.length) return "";
  return html`<fieldset class="field"><legend>Opciones (features)</legend><div class="role-options" id="${id}">${features.map((f) => html`<label class="role-option"><input type="checkbox" data-feature="${f.name}" ${f.initial ? "checked" : ""}><span><b><code>--${f.name}</code></b>${f.default ? html` <span class="badge">por defecto</span>` : ""}<span class="muted small">${f.description}${f.requires.length ? " · requiere " + f.requires.join(", ") : ""}${f.conflicts.length ? " · no combina con " + f.conflicts.join(", ") : ""}${f.notes.length ? " · " + f.notes.join(" · ") : ""}</span></span></label>`)}</div><p class="hint">${hint}</p></fieldset>`;
}

/** Keeps the boxes consistent (checking one checks what it requires and unchecks what conflicts) and reports the flags. */
export function bindFeaturePicker(root, id, features, onChange) {
  const container = root.querySelector("#" + id);
  if (!container) return;
  const box = (name) => container.querySelector(`[data-feature="${name}"]`);
  const byName = new Map(features.map((f) => [f.name, f]));
  const check = (name, seen = new Set()) => {
    if (seen.has(name)) return;
    seen.add(name);
    box(name).checked = true;
    for (const required of byName.get(name).requires) check(required, seen);
    // A conflicting feature goes off, and so does everything that needs it.
    for (const other of byName.get(name).conflicts) uncheck(other);
    for (const f of features) if (f.conflicts.includes(name)) uncheck(f.name);
  };
  function uncheck(name) {
    if (!box(name).checked) return;
    box(name).checked = false;
    for (const f of features) if (f.requires.includes(name)) uncheck(f.name);
  }
  container.addEventListener("change", (event) => {
    const name = event.target?.dataset?.feature;
    if (!name) return;
    // The clicked box already changed: cascade from it (what it requires, or what needs it).
    if (event.target.checked) check(name);
    else for (const f of features) if (f.requires.includes(name)) uncheck(f.name);
    // Flags express the difference with what the CLI does on its own (see `initial`).
    onChange(features.map((f) => (box(f.name).checked === f.initial ? "" : box(f.name).checked ? "--" + f.name : "--no-" + f.name)).filter(Boolean));
  });
}
