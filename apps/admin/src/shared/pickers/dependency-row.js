import { html } from "../lib/html.js";
import { icon } from "../lib/icons.js";

const RANGE_OPS = [
  ["^", "Compatible (^)"],
  ["~", "Solo parches (~)"],
  ["=", "Exacta"],
  ["*", "Cualquiera"],
  ["custom", "Personalizado"],
];

export const splitRange = (range) => {
  const match = /^([\^~]?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(range);
  if (match) return { op: match[1] || "=", version: match[2], custom: "" };
  return range === "*" ? { op: "*", version: "", custom: "" } : { op: "custom", version: "", custom: range };
};

export function rangeOf(row) {
  if (row.op === "custom") return row.custom.trim();
  if (row.op === "*") return "*";
  if (!row.version) return "";
  return row.op === "=" ? row.version : row.op + row.version;
}

const selected = (on) => (on ? "selected" : "");

function versionOption(version, i, versions, current) {
  const latest = i === 0 && version === versions[0] ? " (última)" : "";
  const unpublished = versions.includes(version) ? "" : " (no publicada)";
  return html`<option value="${version}" ${selected(version === current)}>${version}${latest}${unpublished}</option>`;
}

function versionSelect(key, row, versions) {
  const shown = row.version && !versions.includes(row.version) ? [row.version, ...versions] : versions;
  const enabled = row.pkg && row.op !== "*" && row.op !== "custom";
  const options = shown.length
    ? shown.map((version, i) => versionOption(version, i, versions, row.version))
    : html`<option value="">—</option>`;
  return html`<div class="field"><label for="${key}Version">Versión</label><select id="${key}Version" data-dep-version ${enabled ? "" : "disabled"}>${options}</select></div>`;
}

function rowHint(row, described) {
  if (!row.pkg) return "Elige un namespace y un paquete.";
  return html`Se instalará <code>${row.pkg}</code> <code>${rangeOf(row) || "?"}</code>${described?.description ? html` · ${described.description}` : ""}`;
}

function customField(key, row) {
  if (row.op !== "custom") return "";
  return html`<div class="field"><label for="${key}Custom">Rango SemVer</label><input id="${key}Custom" data-dep-custom value="${row.custom}" placeholder=">=1.2.0 <2.0.0" spellcheck="false"></div>`;
}

export function dependencyRow({ key, index, row, namespaces, packages, versions, described }) {
  return html`<div class="dep-row" data-index="${index}">
      <div class="dep-grid">
        <div class="field"><label for="${key}Ns">Namespace</label><select id="${key}Ns" data-dep-ns><option value="">Elige…</option>${namespaces.map((ns) => html`<option value="${ns}" ${selected(ns === row.ns)}>${ns}</option>`)}</select></div>
        <div class="field"><label for="${key}Pkg">Paquete</label><select id="${key}Pkg" data-dep-pkg ${row.ns ? "" : "disabled"}><option value="">Elige…</option>${packages.map((name) => html`<option value="${name}" ${selected(name === row.pkg)}>${name.slice(row.ns.length + 1)}</option>`)}</select></div>
        ${versionSelect(key, row, versions)}
        <div class="field"><label for="${key}Op">Rango</label><select id="${key}Op" data-dep-op>${RANGE_OPS.map(([value, label]) => html`<option value="${value}" ${selected(value === row.op)}>${label}</option>`)}</select></div>
        <button type="button" class="icon-button small danger" data-dep-remove aria-label="Quitar ${row.pkg || "dependencia"}">${icon("trash", 16)}</button>
      </div>
      ${customField(key, row)}
      <p class="hint">${rowHint(row, described)}</p>
    </div>`;
}
