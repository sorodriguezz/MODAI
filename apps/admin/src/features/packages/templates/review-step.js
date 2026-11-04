import { store } from "../../../app/state.js";
import { post } from "../../../shared/lib/api.js";
import { formatBytes } from "../../../shared/lib/files.js";
import { html, toMarkup } from "../../../shared/lib/html.js";
import { reviewList } from "../../../shared/lib/wizard.js";
import { codeBlock } from "../../../shared/ui/code-block.js";
import { closeDialogAndWait } from "../../../shared/ui/dialog.js";
import { toast } from "../../../shared/ui/toast.js";
import { useCommand } from "../detail/template-usage.js";
import { declaration } from "./options-step.js";
import { editorContent } from "./source-step.js";
import { splitTags } from "./template-common.js";

export const reviewStep = () =>
  html`<section data-step="review" data-title="Revisión"><div class="stack" id="tplReview"></div></section>`;

function filesDisclosure(paths) {
  return toMarkup(
    html`<details class="disclosure"><summary>Archivos (${paths.length})</summary><ul class="file-summary">${paths.slice(0, 300).map((path) => html`<li><code>${path}</code></li>`)}${paths.length > 300 ? html`<li class="muted">… y ${paths.length - 300} más</li>` : ""}</ul></details>`,
  );
}

function optionNames(ctx) {
  return Object.keys(
    declaration(ctx)?.features ?? Object.fromEntries((ctx.declared.features || []).map((f) => [f.name, f])),
  );
}

export async function enterReview(ctx) {
  const { form } = ctx;
  if (ctx.source() === "editor") await editorContent(ctx);
  const summary = ctx.summary;
  const box = form.querySelector("#tplReview");
  const options = optionNames(ctx);
  const version = form.tplVersion.value.trim();
  box.innerHTML = reviewList([
    ["Template", `${ctx.name()}@${version}`],
    ["Descripción", form.tplDescription.value.trim()],
    ["Categoría", form.tplCategory.value || "template"],
    ["Etiquetas", splitTags(form.tplTags.value)],
    ["Opciones", options.map((option) => `--${option}`)],
    ["Contenido", summary ? `${summary.label} · ${formatBytes(summary.size)}` : ""],
  ]);
  if (summary?.paths) box.insertAdjacentHTML("beforeend", filesDisclosure(summary.paths));
  box.insertAdjacentHTML(
    "beforeend",
    toMarkup(
      html`<p class="hint">Después se usa con:</p>${codeBlock("tplUse", useCommand(ctx.name(), version, options.length ? [`--${options[0]}`] : []), "Copiar")}`,
    ),
  );
}

export async function publishTemplate(ctx) {
  const { form } = ctx;
  const keywords = splitTags(form.tplTags.value, true);
  const declared = declaration(ctx);
  const { package: published } = await post("/packages/import-template", {
    name: ctx.name(),
    version: form.tplVersion.value.trim(),
    description: form.tplDescription.value.trim(),
    ...(form.tplCategory.value ? { category: form.tplCategory.value } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(declared ? { declaration: declared } : {}),
    ...ctx.content,
  });
  store.invalidate("summary");
  await closeDialogAndWait();
  toast(`Template ${published.name}@${published.version} publicado`);
  await ctx.onPublished?.(published);
}
