// Dependency picker shared by the package editor (dependencies, per-feature packages) and the template editor:
// one row per package, chosen by namespace → package → published version, plus how strictly to follow it.
import { html, mount } from "./html.js";
import { icon } from "./icons.js";
import { get } from "./api.js";
import { compareVersions } from "./versions.js";

const RANGE_OPS = [["^", "Compatible (^)"], ["~", "Solo parches (~)"], ["=", "Exacta"], ["*", "Cualquiera"], ["custom", "Personalizado"]];
const splitRange = (range) => {
  const match = /^([\^~]?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(range);
  if (match) return { op: match[1] || "=", version: match[2], custom: "" };
  return range === "*" ? { op: "*", version: "", custom: "" } : { op: "custom", version: "", custom: range };
};
/** The SemVer range a row stands for ("" while it is incomplete). */
const rangeOf = (row) => row.op === "custom" ? row.custom.trim() : row.op === "*" ? "*" : !row.version ? "" : row.op === "=" ? row.version : row.op + row.version;

// One catalog per page load: every picker in every dialog shares it. Templates are not installable, so they never appear.
let catalogPromise = null;
const versionCache = new Map();
function loadCatalog() {
  catalogPromise ??= (async () => {
    const items = [];
    for (let offset = 0; ; offset += 100) {
      const page = await get(`/packages/catalog?limit=100&offset=${offset}`);
      items.push(...page.items);
      if (offset + 100 >= page.total) break;
    }
    return items.filter((item) => item.manifest?.kind !== "Template");
  })().catch((error) => { catalogPromise = null; throw error; });
  return catalogPromise;
}
async function loadVersions(name) {
  if (!name || versionCache.has(name)) return;
  try {
    const { packages } = await get("/packages?name=" + encodeURIComponent(name));
    versionCache.set(name, packages.map((item) => item.version).sort((a, b) => compareVersions(b, a)));
  } catch { versionCache.set(name, []); }
}
/** Forget what was loaded (after publishing, the new package must show up). */
export function resetDependencyCatalog() { catalogPromise = null; versionCache.clear(); }

/**
 * @param {HTMLElement} container
 * @param {{ id: string, initial?: Record<string, string>, exclude?: () => string, emptyText?: () => string, onChange?: () => void }} options
 *   `exclude()` is the package being edited (never offered); `onChange` runs after every edit.
 */
export function dependencyPicker(container, { id, initial = {}, exclude = () => "", emptyText = () => "Sin dependencias.", onChange = () => {} }) {
  const rows = Object.entries(initial).map(([pkg, range]) => ({ ns: pkg.split("/")[0], pkg, ...splitRange(range) }));
  let catalog = [];
  let status = "loading";
  let touched = false;

  const namespaces = (row) => [...new Set([...catalog.map((item) => item.name.split("/")[0]), ...(row.ns ? [row.ns] : [])])].sort();
  const packagesIn = (row, index) => {
    const taken = new Set(rows.filter((other, i) => i !== index && other.pkg).map((other) => other.pkg));
    const names = catalog.filter((item) => item.name.startsWith(row.ns + "/") && item.name !== exclude() && !taken.has(item.name)).map((item) => item.name);
    return row.pkg && !names.includes(row.pkg) ? [row.pkg, ...names] : names;
  };
  const rowMarkup = (row, index) => {
    const versions = versionCache.get(row.pkg) || [];
    const shown = row.version && !versions.includes(row.version) ? [row.version, ...versions] : versions;
    const described = catalog.find((item) => item.name === row.pkg);
    const key = `${id}${index}`;
    return html`<div class="dep-row" data-index="${index}">
      <div class="dep-grid">
        <div class="field"><label for="${key}Ns">Namespace</label><select id="${key}Ns" data-dep-ns><option value="">Elige…</option>${namespaces(row).map((ns) => html`<option value="${ns}" ${ns === row.ns ? "selected" : ""}>${ns}</option>`)}</select></div>
        <div class="field"><label for="${key}Pkg">Paquete</label><select id="${key}Pkg" data-dep-pkg ${row.ns ? "" : "disabled"}><option value="">Elige…</option>${packagesIn(row, index).map((name) => html`<option value="${name}" ${name === row.pkg ? "selected" : ""}>${name.slice(row.ns.length + 1)}</option>`)}</select></div>
        <div class="field"><label for="${key}Version">Versión</label><select id="${key}Version" data-dep-version ${row.pkg && row.op !== "*" && row.op !== "custom" ? "" : "disabled"}>${shown.length ? shown.map((version, i) => html`<option value="${version}" ${version === row.version ? "selected" : ""}>${version}${i === 0 && version === versions[0] ? " (última)" : ""}${versions.includes(version) ? "" : " (no publicada)"}</option>`) : html`<option value="">—</option>`}</select></div>
        <div class="field"><label for="${key}Op">Rango</label><select id="${key}Op" data-dep-op>${RANGE_OPS.map(([value, label]) => html`<option value="${value}" ${value === row.op ? "selected" : ""}>${label}</option>`)}</select></div>
        <button type="button" class="icon-button small danger" data-dep-remove aria-label="Quitar ${row.pkg || "dependencia"}">${icon("trash", 16)}</button>
      </div>
      ${row.op === "custom" ? html`<div class="field"><label for="${key}Custom">Rango SemVer</label><input id="${key}Custom" data-dep-custom value="${row.custom}" placeholder=">=1.2.0 <2.0.0" spellcheck="false"></div>` : ""}
      <p class="hint">${row.pkg ? html`Se instalará <code>${row.pkg}</code> <code>${rangeOf(row) || "?"}</code>${described?.description ? html` · ${described.description}` : ""}` : "Elige un namespace y un paquete."}</p>
    </div>`;
  };
  const draw = (focus) => {
    mount(container, rows.length ? rows.map(rowMarkup)
      : html`<p class="muted small">${status === "loading" ? "Cargando paquetes…" : status === "error" ? "No se pudo cargar el catálogo." : emptyText()}</p>`);
    if (focus) container.querySelector(`[data-index="${focus.index}"] ${focus.selector}`)?.focus();
  };
  const changed = () => { touched = true; onChange(); };

  container.addEventListener("change", async (event) => {
    const el = event.target;
    const index = Number(el.closest("[data-index]")?.dataset.index);
    const row = rows[index];
    if (!row) return;
    let selector = "select";
    if (el.matches("[data-dep-ns]")) { Object.assign(row, { ns: el.value, pkg: "", version: "" }); selector = "[data-dep-pkg]"; }
    else if (el.matches("[data-dep-pkg]")) {
      row.pkg = el.value;
      await loadVersions(row.pkg);
      row.version = versionCache.get(row.pkg)?.[0] || "";
      selector = "[data-dep-op]";
    } else if (el.matches("[data-dep-version]")) { row.version = el.value; selector = "[data-dep-version]"; }
    else if (el.matches("[data-dep-op]")) { row.op = el.value; selector = row.op === "custom" ? "[data-dep-custom]" : "[data-dep-op]"; }
    else return;
    draw({ index, selector });
    changed();
  });
  container.addEventListener("input", (event) => {
    if (!event.target.matches("[data-dep-custom]")) return;
    rows[Number(event.target.closest("[data-index]").dataset.index)].custom = event.target.value;
    changed();
  });
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-dep-remove]");
    if (!button) return;
    rows.splice(Number(button.closest("[data-index]").dataset.index), 1);
    draw();
    changed();
  });

  draw();
  loadCatalog().then((items) => { catalog = items; status = "ready"; }, () => { status = "error"; })
    .then(() => Promise.all(rows.map((row) => loadVersions(row.pkg))))
    .then(() => { if (document.contains(container)) draw(); });

  return {
    /** The chosen packages as { "@scope/name": range }, leaving out incomplete rows. */
    get value() { return Object.fromEntries(rows.filter((row) => row.pkg && rangeOf(row)).map((row) => [row.pkg, rangeOf(row)])); },
    get touched() { return touched; },
    get size() { return rows.length; },
    add() { rows.push({ ns: "", pkg: "", op: "^", version: "", custom: "" }); draw({ index: rows.length - 1, selector: "[data-dep-ns]" }); changed(); },
    draw,
    /** What blocks the step, or "". */
    issue() {
      const names = rows.filter((row) => row.pkg).map((row) => row.pkg);
      if (rows.some((row) => !row.pkg)) return "Elige un namespace y un paquete en cada dependencia, o quita la fila.";
      if (rows.some((row) => !rangeOf(row))) return "Elige una versión (o un rango) para cada dependencia.";
      if (exclude() && names.includes(exclude())) return "Un paquete no puede depender de sí mismo.";
      return new Set(names).size !== names.length ? "Hay una dependencia repetida." : "";
    },
  };
}
