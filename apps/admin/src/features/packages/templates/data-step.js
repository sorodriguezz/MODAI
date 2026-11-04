import { can } from "../../../app/state.js";
import { get } from "../../../shared/lib/api.js";
import { html } from "../../../shared/lib/html.js";
import { bindVersionCheck } from "../../../shared/lib/versions.js";
import { bindCategorySearch, categoryField } from "../../../shared/pickers/category-field.js";
import { bindNamespaceSearch, namespaceField } from "../../../shared/pickers/namespace-field.js";
import { nextTemplateVersion } from "./template-common.js";

export function dataStep({ base, namespaces, categories, baseNamespace, baseShort, baseCategory }) {
  return html`<section data-step="data" data-title="Datos"><div class="stack">
        <div class="field-row">
          ${namespaceField({ id: "tplNamespace", names: namespaces, selected: baseNamespace, readonly: Boolean(base) })}
          <div class="field"><label for="tplName">Nombre</label><input id="tplName" required pattern="[a-z0-9][a-z0-9._\\-]*" placeholder="nestjs-sdd" value="${baseShort}" ${base ? "readonly" : ""}></div>
          <div class="field"><label for="tplVersion">Versión</label><input id="tplVersion" required pattern="\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.\\-]+)?" value="${nextTemplateVersion(base)}"><p class="hint" id="tplVersionHint">SemVer: 1.2.3</p></div>
        </div>
        <div class="field"><label for="tplDescription">Descripción</label><textarea id="tplDescription" rows="3" required maxlength="5000" placeholder="Qué incluye, para qué tipo de proyecto sirve y cómo se arranca.">${base?.description || ""}</textarea></div>
        <div class="field-row">
          ${categoryField({ id: "tplCategory", categories, selected: baseCategory, fallback: "template" })}
          <div class="field"><label for="tplTags">Etiquetas (opcional)</label><input id="tplTags" maxlength="400" placeholder="nestjs, postgres, sdd" value="${(base?.manifest?.metadata?.keywords || []).join(", ")}"><p class="hint">Tecnologías y temas; también sirven para buscar.</p></div>
        </div>
      </div></section>`;
}

export function bindDataStep(ctx) {
  const { form } = ctx;
  bindNamespaceSearch(form, "tplNamespace", ctx.namespaces);
  bindCategorySearch(form, "tplCategory", ctx.categories, ctx.baseCategory);
  ctx.versionCheck = bindVersionCheck({
    name: ctx.name,
    input: form.tplVersion,
    hint: form.querySelector("#tplVersionHint"),
    fetchVersions: async (full) =>
      (await get(`/packages?includeYanked=true&name=${encodeURIComponent(full)}`)).packages.map((item) => item.version),
    watch: [form.tplNamespace, form.tplName],
  });
}

export function validateData({ form, versionCheck }) {
  const namespace = form.tplNamespace.value.trim();
  if (!namespace) return "Elige un namespace.";
  if (!can.publishTo(namespace)) return `No puedes publicar en ${namespace}.`;
  return versionCheck.problem();
}
