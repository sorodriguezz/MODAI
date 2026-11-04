import { html } from "../../../shared/lib/html.js";
import { featureEditor } from "../../../shared/pickers/feature-editor/feature-editor.js";

export function optionsStep({ base }) {
  return html`<section data-step="features" data-title="Opciones"><div class="stack">
        <p class="hint">Opciones que quien instala activa con <code>modai add ${base?.name || "@equipo/paquete"} --nombre</code> (y <code>--no-nombre</code> quita una activada por defecto). Cada una puede añadir una carpeta de archivos al componente e instalar paquetes extra. Después se cambian con <code>modai feature enable|disable</code>.</p>
        <div id="featureEditor"></div>
      </div></section>`;
}

const foldersOf = (s) =>
  [
    ...new Set(
      [...s.files.keys()].filter((path) => path.includes("/")).map((path) => path.slice(0, path.lastIndexOf("/"))),
    ),
  ].sort();

export function createFeatures(ctx) {
  return featureEditor(ctx.$("featureEditor"), {
    id: "pkgFeatures",
    mode: "package",
    initial: ctx.base?.manifest?.spec?.features,
    exclude: ctx.pkgFullName,
    folders: () => foldersOf(ctx.s),
    onChange: () => ctx.syncManifest(),
  });
}

export const skipOptions = ({ s, baseComponents }) =>
  !(s.template === "component" || (s.template === "existing" && baseComponents.length));
