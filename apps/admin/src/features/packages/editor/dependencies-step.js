import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { dependencyPicker } from "../../../shared/pickers/dependency-picker.js";

export function dependenciesStep() {
  return html`<section data-step="dependencies" data-title="Dependencias"><div class="stack">
        <p class="hint" id="depHint"></p>
        <div id="depList" class="stack"></div>
        <div><button type="button" class="btn small" data-action="addDependency">${icon("plus", 16)}<span id="addDependencyLabel">Añadir dependencia</span></button></div>
      </div></section>`;
}

export function createDependencies(ctx) {
  const { s } = ctx;
  return dependencyPicker(ctx.$("depList"), {
    id: "dep",
    initial: s.dependencies,
    exclude: ctx.pkgFullName,
    emptyText: () => (s.template === "profile" ? "Un perfil necesita al menos un paquete." : "Sin dependencias."),
    onChange: () => ctx.syncManifest(),
  });
}

export function applyKind(ctx) {
  const profile = ctx.s.template === "profile";
  ctx.form.querySelector('[data-step="dependencies"]').dataset.title = profile ? "Composición" : "Dependencias";
  ctx.$("depHint").innerHTML = profile
    ? "Un perfil <b>compone</b> otros paquetes: al instalarlo se instalan todos. Elige cada uno por namespace, nombre y versión. El rango usa SemVer: <code>^1.2.0</code> acepta 1.x desde 1.2.0."
    : "Otros paquetes que este necesita. Se instalan junto con él. El rango usa SemVer: <code>^1.2.0</code> acepta 1.x desde 1.2.0.";
  ctx.$("addDependencyLabel").textContent = profile ? "Añadir paquete" : "Añadir dependencia";
  ctx.deps.draw();
  ctx.steps?.show(ctx.steps.current);
}

export function validateDependencies(ctx) {
  ctx.readForm();
  const { s } = ctx;
  return (
    ctx.deps.issue() ||
    (s.template === "profile" && !Object.keys(s.dependencies).length
      ? "Un perfil compone paquetes: añade al menos uno."
      : "")
  );
}
