// Structural quality report (from @modai/contracts/package-quality): the score is the average of the dimensions that
// apply to what the package contains, and each finding says what to change. Shared by the editor review, the .skill
// import preview and the package detail.
import { html } from "./html.js";
import { icon } from "./icons.js";

const DIMENSIONS = {
  manifest: ["Manifiesto", "El manifiesto es válido."],
  documentation: ["Documentación", "Descripción de 30 caracteres o más."],
  discovery: ["Descubrimiento", "La skill tiene name y una description que dice cuándo activarla."],
  instructions: ["Instrucciones", "El cuerpo de SKILL.md tiene entre 250 y 12.000 caracteres."],
  progressiveDisclosure: ["Carga progresiva", "El detalle va en references/ en vez de en SKILL.md."],
  safety: ["Alcance y seguridad", "Dice qué queda fuera de alcance o qué requiere permiso."],
  validation: ["Verificación", "Define cómo comprobar el resultado (pruebas, evidencia)."],
  contracts: ["Contratos", "Declara spec.provides o tools[].implements."],
  toolSafety: ["Esquemas de herramientas", "Cada herramienta acota su inputSchema."],
};
const tone = { error: "danger", warning: "warning", info: "info" };
const scoreTone = (score) => (score >= 80 ? "success" : score >= 50 ? "warning" : "danger");

function dimensionList(dimensions = {}) {
  const entries = Object.entries(dimensions);
  if (!entries.length) return "";
  return html`<div class="quality-dimensions">
    <p class="hint">La nota es el promedio de ${entries.length === 1 ? "esta dimensión" : `estas ${entries.length} dimensiones`}; solo cuentan las que aplican a lo que contiene el paquete.</p>
    <ul>${entries.map(([key, value]) => html`<li class="tone-${scoreTone(value)}">
      <span class="quality-dimension-name"><b>${DIMENSIONS[key]?.[0] || key}</b><span class="muted small">${DIMENSIONS[key]?.[1] || ""}</span></span>
      <span class="quality-bar" aria-hidden="true"><span style="width:${value}%"></span></span>
      <span class="quality-value">${value}</span></li>`)}</ul></div>`;
}

function findingList(findings = []) {
  return findings.length
    ? html`<ul class="findings">${findings.map((f) => html`<li class="tone-${tone[f.severity] || "info"}">${icon(f.severity === "info" ? "info" : "alert", 16)}<span><code>${f.code}</code> ${f.message}</span></li>`)}</ul>`
    : "";
}

/** Compact report for a review step: verdict, what to fix and the breakdown. */
export function qualityMarkup(quality) {
  const blocked = quality.findings?.some((f) => f.severity === "error");
  return html`<div class="callout tone-${scoreTone(quality.score)}">${icon(quality.score >= 50 ? "check" : "alert")}<span><b>Calidad estructural ${quality.score}/100.</b> ${blocked ? "Corrige los errores antes de publicar." : "Puedes publicar."} Los errores bloquean la publicación; los avisos son mejoras sugeridas.</span></div>
    ${findingList(quality.findings)}
    ${dimensionList(quality.dimensions)}`;
}

/** Full report for the Calidad tab of a published version. */
export function qualityPanel(quality) {
  if (!quality) return html`<p class="muted">Esta versión no tiene evaluación estructural.</p>`;
  return html`<div class="quality-score"><strong>${quality.score}</strong><span>/100</span></div>
    <p class="hint">Evalúa cómo está armado el paquete; no sustituye probar su comportamiento con tareas reales.</p>
    ${dimensionList(quality.dimensions)}
    ${quality.findings?.length ? findingList(quality.findings) : html`<p class="muted small">Sin observaciones.</p>`}`;
}
