import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { openSkillImport } from "../skill-import/skill-import.js";
import { openTemplateEditor } from "../templates/template-editor.js";
import { TEMPLATES } from "./package-types.js";

export function typeStep({ s, base }) {
  if (base) return "";
  return html`<section data-step="type" data-title="Tipo"><fieldset class="field"><legend>¿Qué quieres compartir?</legend><div class="role-options">${Object.entries(
    TEMPLATES,
  ).map(
    ([id, t]) => html`
        <label class="role-option"><input type="radio" name="template" value="${id}" ${id === s.template ? "checked" : ""}><span><b>${icon(t.icon, 16)} ${t.label}</b><span class="muted small">${t.text}</span></span></label>`,
  )}</div></fieldset>
        <fieldset class="field" data-skill-mode ${s.template === "skill" ? "" : "hidden"}><legend>¿Cómo quieres crear la skill?</legend><div class="role-options">
          <label class="role-option"><input type="radio" name="skillMode" value="create" checked><span><b>${icon("edit", 16)} Crearla aquí</b><span class="muted small">Escribe el SKILL.md y sus referencias en el editor.</span></span></label>
          <label class="role-option"><input type="radio" name="skillMode" value="upload"><span><b>${icon("download", 16)} Subir un archivo .skill</b><span class="muted small">Un ZIP con SKILL.md (por ejemplo, exportado desde Claude). Se convierte en paquete con vista previa.</span></span></label>
        </div></fieldset></section>`;
}

export function bindTypeStep(ctx) {
  const { s, form } = ctx;
  for (const radio of form.querySelectorAll('input[name="template"]'))
    radio.addEventListener("change", () => {
      const mode = form.querySelector("[data-skill-mode]");
      if (mode) mode.hidden = radio.value !== "skill";
      ctx.readForm();
      s.template = radio.value;
      if (!s.meta.category) s.meta.category = "";
      ctx.loadStarter();
      ctx.drawTemplateFields();
      ctx.applyKind();
      ctx.refresh();
    });
}

export function validateType({ s, form, onPublished }) {
  if (s.template === "skill" && form.querySelector('input[name="skillMode"]:checked')?.value === "upload")
    openSkillImport({ onPublished });
  if (s.template === "template") openTemplateEditor({ onPublished });
  return "";
}
