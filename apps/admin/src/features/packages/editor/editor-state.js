import { textToBytes } from "../../../shared/lib/files.js";
import { buildManifest, withIdentity } from "./manifest-builder.js";
import { slug, TEMPLATES } from "./package-types.js";

export function readForm(ctx) {
  const { s, $ } = ctx;
  s.meta.name = `${$("pkgNamespace").value.trim()}/${$("pkgName").value.trim()}`;
  s.meta.version = $("pkgVersion").value.trim();
  s.meta.description = $("pkgDescription").value.trim();
  if ($("pkgCategory")) s.meta.category = $("pkgCategory").value.trim();
  if ($("compName"))
    Object.assign(s.component, {
      name: $("compName").value.trim(),
      target: $("compTarget").value.trim(),
      language: $("compLanguage").value.trim(),
    });
  if ($("skillName")) s.skill = slug($("skillName").value, "mi-skill");
  s.dependencies = ctx.deps.value;
  s.features = ctx.features.size
    ? ctx.features.packageFeatures(ctx.baseComponents[0]?.name || slug(s.component.name, "component"))
    : {};
}

function parseManifest(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`El manifiesto no es JSON válido: ${error.message}`);
  }
}

export function currentManifest(ctx) {
  const { s } = ctx;
  readForm(ctx);
  if (!s.manifestDirty) return buildManifest(s);
  return withIdentity(parseManifest(ctx.$("pkgManifest").value), s.meta, {
    dependencies: ctx.deps.touched ? s.dependencies : undefined,
    features: ctx.features.touched ? s.features : undefined,
  });
}

export function syncManifest(ctx) {
  const { s, $ } = ctx;
  if (s.manifestDirty) {
    $("pkgManifest").value = s.manifestText || $("pkgManifest").value;
    s.manifestText = "";
    return;
  }
  try {
    $("pkgManifest").value = JSON.stringify(currentManifest(ctx), null, 2);
    ctx.clearError();
  } catch (error) {
    ctx.showError(error);
  }
}

export const untouchedStarter = (s) => [...s.files.keys()].every((path) => s.starter.has(path));

export function loadStarter({ s }) {
  if (s.template === "existing" || !untouchedStarter(s)) return;
  s.files.clear();
  s.starter = new Set();
  for (const [path, text] of Object.entries(TEMPLATES[s.template].starter(s))) {
    s.files.set(path, { bytes: textToBytes(text) });
    s.starter.add(path);
  }
}
