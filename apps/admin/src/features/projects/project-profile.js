import { can } from "../../app/state.js";
import { get } from "../../shared/lib/api.js";
import { html, mount } from "../../shared/lib/html.js";
import { openDialog } from "../../shared/ui/dialog.js";
import { errorState } from "../../shared/ui/empty-state.js";
import { bindTabs } from "../../shared/ui/tabs.js";
import { renderBindings, scopeNames } from "./profile-bindings.js";
import { renderTeams } from "./profile-teams.js";

function effectiveDetails(profile) {
  const capabilities = Object.entries(profile.capabilities);
  return html`<div class="stack">
    <h3>Asignaciones aplicadas a tu cuenta</h3>
    ${profile.bindings.length ? html`<ul>${profile.bindings.map((item) => html`<li><code>${item.slot}</code> ${item.packageName}@${item.range} · ${scopeNames[item.target.scope]}${item.required ? " · Obligatoria" : ""}</li>`)}</ul>` : html`<p class="muted">El perfil no tiene asignaciones aplicables.</p>`}
    ${profile.packages.length ? html`<h3>Versiones resueltas</h3><ul>${profile.packages.map((item) => html`<li><code>${item.name}@${item.version}</code></li>`)}</ul>` : ""}
    ${capabilities.length ? html`<h3>Capacidades</h3><ul>${capabilities.map(([name, item]) => html`<li><code>${name}</code> · ${item.provider}@${item.version}</li>`)}</ul>` : ""}
  </div>`;
}

export function openProjectProfile(project, tab = "effective") {
  const organization = project.organizationId;
  const manage = can.admin() || can.managedOrganizations().some(({ id }) => id === organization);
  const root = openDialog({
    title: `Perfil de ${project.name}`,
    size: "lg",
    body: html`<div>
      <div class="tabs" role="tablist" aria-label="Perfil del proyecto">
        <button role="tab" type="button" data-tab="effective" aria-selected="true">Perfil efectivo</button>
        ${manage ? html`<button role="tab" type="button" data-tab="bindings" aria-selected="false" tabindex="-1">Asignaciones</button>` : ""}
        ${manage && organization ? html`<button role="tab" type="button" data-tab="teams" aria-selected="false" tabindex="-1">Equipos</button>` : ""}
      </div>
      <div role="tabpanel" data-panel="effective" class="tab-panel"></div>
      ${manage ? html`<div role="tabpanel" data-panel="bindings" class="tab-panel" hidden></div>` : ""}
      ${manage && organization ? html`<div role="tabpanel" data-panel="teams" class="tab-panel" hidden></div>` : ""}
    </div>`,
  }).firstElementChild;
  const load = async (selected) => {
    const panel = root.querySelector(`[data-panel="${selected}"]`);
    mount(panel, html`<div><p class="muted" role="status">Cargando…</p></div>`);
    const outlet = panel.firstElementChild;
    try {
      if (selected === "bindings") await renderBindings(outlet, project, () => openProjectProfile(project, selected));
      else if (selected === "teams") await renderTeams(outlet, project, () => openProjectProfile(project, selected));
      else {
        const { profile } = await get(`/projects/${encodeURIComponent(project.id)}/effective-profile`);
        mount(outlet, effectiveDetails(profile));
      }
    } catch (error) {
      mount(outlet, errorState(error));
    }
  };
  bindTabs(root, load);
  root.querySelector(`[data-tab="${tab}"]`).click();
}
