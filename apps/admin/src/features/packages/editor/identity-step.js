import { can } from "../../../app/state.js";
import { html, mount } from "../../../shared/lib/html.js";
import { bindCategorySearch, categoryField } from "../../../shared/pickers/category-field.js";
import { namespaceField } from "../../../shared/pickers/namespace-field.js";
import { TEMPLATES } from "./package-types.js";

export function identityStep({ s, base, pkgNamespaces, pkgScope, pkgShort }) {
  return html`<section data-step="identity" data-title="Identidad"><div class="stack">
      <div class="field-row">
        <div class="field-row">
          ${namespaceField({ id: "pkgNamespace", names: pkgNamespaces, selected: pkgScope, readonly: Boolean(base) })}
          <div class="field"><label for="pkgName">Nombre</label><input id="pkgName" required pattern="[a-z0-9][a-z0-9._\\-]*" placeholder="auth-module" value="${pkgShort}" ${base ? "readonly" : ""} spellcheck="false" autocapitalize="off"><p class="hint">En minúsculas. El paquete será <code>namespace/nombre</code>.</p></div>
        </div>
        <div class="field"><label for="pkgVersion">Versión</label><input id="pkgVersion" required pattern="\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.\\-]+)?" value="${s.meta.version}"><p class="hint" id="pkgVersionHint">SemVer: 1.2.3</p></div>
      </div>
      <div class="field"><label for="pkgDescription">Descripción</label><textarea id="pkgDescription" rows="2" required maxlength="5000" placeholder="Qué aporta, cuándo usarlo y qué espera del proyecto.">${s.meta.description}</textarea></div>
      <div id="templateFields"></div>
      </div></section>`;
}

function componentFields(s, category) {
  return html`<div class="stack"><div class="field-row">
          <div class="field"><label for="compName">Nombre del componente</label><input id="compName" required pattern="[a-z0-9][a-z0-9\\-]{0,63}" placeholder="auth" value="${s.component.name}"></div>
          <div class="field"><label for="compLanguage">Lenguaje o framework</label><input id="compLanguage" maxlength="64" placeholder="nestjs, express, react, python…" value="${s.component.language}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="compTarget">Destino en el proyecto</label><input id="compTarget" required placeholder="src/modules/{component}" value="${s.component.target}"><p class="hint">Carpeta donde <code>modai add</code> copia los archivos de <code>component/</code>. Admite {component} y {package}.</p></div>
          ${category}
        </div></div>`;
}

function skillFields(s, category) {
  return html`<div class="field-row"><div class="field"><label for="skillName">Nombre de la skill</label><input id="skillName" pattern="[a-z0-9][a-z0-9\\-]{0,63}" value="${s.skill}"><p class="hint">Cada carpeta <code>skills/&lt;nombre&gt;/</code> con un SKILL.md es una skill.</p></div>${category}</div>`;
}

const UPLOAD_HINTS = {
  existing: "Edita, añade o elimina archivos; el manifiesto declara cuáles se instalan.",
  component: "Sube la carpeta con tu código: se guarda en component/ y se instalará en el destino indicado.",
  harness: "Los archivos de harness/ se instalan con la misma ruta en el proyecto (harness/AGENTS.md → AGENTS.md).",
};

function uploadHint(template, root) {
  if (UPLOAD_HINTS[template]) return UPLOAD_HINTS[template];
  return root
    ? `Los archivos subidos se guardan en ${root}/.`
    : "Los archivos subidos se guardan en la raíz del paquete.";
}

export function drawTemplateFields({ s, base, form, categories, $ }) {
  const t = TEMPLATES[s.template];
  const category = categoryField({
    id: "pkgCategory",
    categories,
    selected: s.meta.category,
    fallback: t?.category || base?.manifest?.spec?.category || "general",
  });
  const fields = { component: componentFields, skill: skillFields }[s.template];
  mount($("templateFields"), fields ? fields(s, category) : html`<div class="field-row">${category}</div>`);
  bindCategorySearch(form, "pkgCategory", categories, s.meta.category);
  $("uploadHint").textContent = uploadHint(s.template, t?.root);
}

export function validateIdentity(ctx) {
  ctx.readForm();
  const namespace = ctx.s.meta.name.split("/")[0];
  if (!namespace) return "Elige un namespace.";
  const versionIssue = ctx.versionCheck.problem();
  if (versionIssue) return versionIssue;
  return namespace && !can.publishTo(namespace)
    ? `No tienes permiso para publicar en ${namespace}. Elige uno de tus namespaces o pide acceso a la administración de su organización.`
    : "";
}
