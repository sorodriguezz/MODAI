import { get } from "../../../shared/lib/api.js";
import { html, mount } from "../../../shared/lib/html.js";
import { emptyState, errorState } from "../../../shared/ui/empty-state.js";
import { timeTag } from "../../../shared/ui/format.js";

function projectRow(project, latest) {
  const outdated =
    latest && project.version !== latest.version
      ? html` <span class="badge tone-warning" title="Hay una versión más nueva">desactualizado</span>`
      : "";
  return html`<tr><td><b>${project.projectName}</b><div class="muted small"><code>${project.projectId}</code></div></td>
              <td>${project.version}${outdated}</td>
              <td class="hide-sm">${project.direct ? "Directa" : "Dependencia"}</td><td class="hide-sm">${timeTag(project.reportedAt)}</td></tr>`;
}

function usageMarkup(projects, latest) {
  if (!projects.length)
    return emptyState({
      iconName: "folder",
      title: "Ningún proyecto lo usa",
      text: "O los proyectos que lo instalan no están vinculados a este servidor con modai init --project.",
    });
  return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Proyecto</th><th scope="col">Versión</th><th scope="col" class="hide-sm">Cómo</th><th scope="col" class="hide-sm">Reportado</th></tr></thead>
            <tbody>${projects.map((project) => projectRow(project, latest))}</tbody></table></div>
            <p class="hint">Cada proyecto vinculado a este servidor (modai init --project) informa lo que instala al sincronizar. Solo ves los proyectos a los que tienes acceso.</p>`;
}

export async function loadUsage(body, name, latest) {
  try {
    const { projects } = await get(`/packages/usage?name=${encodeURIComponent(name)}`);
    mount(body.querySelector("#packageUsage"), usageMarkup(projects, latest));
  } catch (error) {
    mount(body.querySelector("#packageUsage"), errorState(error));
  }
}
