import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { describeManifest } from "../../../shared/lib/manifest.js";
import { statusBadge } from "../../../shared/ui/labels.js";

const categoryIcons = {
  component: "code",
  skill: "spark",
  agent: "bot",
  knowledge: "book",
  memory: "brain",
  mcp: "plug",
  tool: "tool",
  adapter: "layers",
  harness: "layers",
  profile: "user",
  template: "copy",
  methodology: "book",
};

function cardIcon(info) {
  return icon(info.kind === "Template" ? "copy" : categoryIcons[info.category] || "package");
}

function cardBadges(item, info) {
  return html`<span class="badge">${info.category}</span>${info.kind && info.kind !== "Package" ? html`<span class="badge tone-info">${info.kind}</span>` : ""}${item.status !== "active" ? statusBadge(item.status) : ""}`;
}

function qualityClass(score) {
  if (score >= 80) return "text-success";
  return score < 50 ? "text-warning" : "";
}

function qualityMeta(quality) {
  if (!quality) return "";
  return html`<span class="${qualityClass(quality.score)}" title="Calidad estructural">${quality.score}/100</span>`;
}

function signatureMeta(item) {
  if (!item.signerFingerprint) return "";
  return html`<span title="Firmado">${icon("shield", 14)}${item.publisherTrusted ? "Confiable" : "Firmado"}</span>`;
}

function cardMeta(item, info) {
  return html`<span class="card-meta">
      <span>v${item.version}${item.versions > 1 ? html` <span class="muted" title="Versiones publicadas">· ${item.versions} versiones</span>` : ""}</span>
      ${info.provides.length ? html`<span title="Capacidades que provee">${icon("spark", 14)}${info.provides.length}</span>` : ""}
      ${qualityMeta(item.quality)}
      ${signatureMeta(item)}
    </span>`;
}

export function packageCard(item) {
  const info = describeManifest(item);
  return html`<button type="button" class="card package-card" data-action="open" data-name="${item.name}" data-version="${item.version}">
    <span class="card-top"><span class="card-icon">${cardIcon(info)}</span>
      <span class="card-badges">${cardBadges(item, info)}</span></span>
    <span class="card-title">${item.name}</span>
    <span class="card-text">${item.description}</span>
    ${cardMeta(item, info)}
  </button>`;
}
