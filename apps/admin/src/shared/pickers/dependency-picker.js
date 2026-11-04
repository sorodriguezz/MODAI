import { get } from "../lib/api.js";
import { html, mount } from "../lib/html.js";
import { compareVersions } from "../lib/versions.js";
import { dependencyRow, rangeOf, splitRange } from "./dependency-row.js";

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
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

async function loadVersions(name) {
  if (!name || versionCache.has(name)) return;
  try {
    const { packages } = await get(`/packages?name=${encodeURIComponent(name)}`);
    versionCache.set(
      name,
      packages.map((item) => item.version).sort((a, b) => compareVersions(b, a)),
    );
  } catch {
    versionCache.set(name, []);
  }
}

export function resetDependencyCatalog() {
  catalogPromise = null;
  versionCache.clear();
}

async function applyChange(el, row) {
  if (el.matches("[data-dep-ns]")) {
    Object.assign(row, { ns: el.value, pkg: "", version: "" });
    return "[data-dep-pkg]";
  }
  if (el.matches("[data-dep-pkg]")) {
    row.pkg = el.value;
    await loadVersions(row.pkg);
    row.version = versionCache.get(row.pkg)?.[0] || "";
    return "[data-dep-op]";
  }
  if (el.matches("[data-dep-version]")) {
    row.version = el.value;
    return "[data-dep-version]";
  }
  if (el.matches("[data-dep-op]")) {
    row.op = el.value;
    return row.op === "custom" ? "[data-dep-custom]" : "[data-dep-op]";
  }
  return null;
}

function rowsIssue(rows, exclude) {
  const names = rows.filter((row) => row.pkg).map((row) => row.pkg);
  if (rows.some((row) => !row.pkg)) return "Elige un namespace y un paquete en cada dependencia, o quita la fila.";
  if (rows.some((row) => !rangeOf(row))) return "Elige una versión (o un rango) para cada dependencia.";
  if (exclude() && names.includes(exclude())) return "Un paquete no puede depender de sí mismo.";
  return new Set(names).size !== names.length ? "Hay una dependencia repetida." : "";
}

function statusText(status, emptyText) {
  if (status === "loading") return "Cargando paquetes…";
  return status === "error" ? "No se pudo cargar el catálogo." : emptyText();
}

function pickerModel(rows, exclude) {
  const model = { catalog: [], status: "loading" };
  model.namespaces = (row) =>
    [...new Set([...model.catalog.map((item) => item.name.split("/")[0]), ...(row.ns ? [row.ns] : [])])].sort();
  model.packagesIn = (row, index) => {
    const taken = new Set(rows.filter((other, i) => i !== index && other.pkg).map((other) => other.pkg));
    const names = model.catalog
      .filter((item) => item.name.startsWith(`${row.ns}/`) && item.name !== exclude() && !taken.has(item.name))
      .map((item) => item.name);
    return row.pkg && !names.includes(row.pkg) ? [row.pkg, ...names] : names;
  };
  return model;
}

function bindEvents(container, rows, draw, changed) {
  container.addEventListener("change", async (event) => {
    const index = Number(event.target.closest("[data-index]")?.dataset.index);
    const row = rows[index];
    if (!row) return;
    const selector = await applyChange(event.target, row);
    if (!selector) return;
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
}

export function dependencyPicker(
  container,
  { id, initial = {}, exclude = () => "", emptyText = () => "Sin dependencias.", onChange = () => {} },
) {
  const rows = Object.entries(initial).map(([pkg, range]) => ({ ns: pkg.split("/")[0], pkg, ...splitRange(range) }));
  const model = pickerModel(rows, exclude);
  let touched = false;
  const rowMarkup = (row, index) =>
    dependencyRow({
      key: `${id}${index}`,
      index,
      row,
      namespaces: model.namespaces(row),
      packages: model.packagesIn(row, index),
      versions: versionCache.get(row.pkg) || [],
      described: model.catalog.find((item) => item.name === row.pkg),
    });
  const draw = (focus) => {
    mount(
      container,
      rows.length ? rows.map(rowMarkup) : html`<p class="muted small">${statusText(model.status, emptyText)}</p>`,
    );
    if (focus) container.querySelector(`[data-index="${focus.index}"] ${focus.selector}`)?.focus();
  };
  const changed = () => {
    touched = true;
    onChange();
  };
  bindEvents(container, rows, draw, changed);
  draw();
  loadCatalog()
    .then(
      (items) => {
        model.catalog = items;
        model.status = "ready";
      },
      () => {
        model.status = "error";
      },
    )
    .then(() => Promise.all(rows.map((row) => loadVersions(row.pkg))))
    .then(() => {
      if (document.contains(container)) draw();
    });
  return {
    get value() {
      return Object.fromEntries(rows.filter((row) => row.pkg && rangeOf(row)).map((row) => [row.pkg, rangeOf(row)]));
    },
    get touched() {
      return touched;
    },
    get size() {
      return rows.length;
    },
    add() {
      rows.push({ ns: "", pkg: "", op: "^", version: "", custom: "" });
      draw({ index: rows.length - 1, selector: "[data-dep-ns]" });
      changed();
    },
    draw,
    issue: () => rowsIssue(rows, exclude),
  };
}
