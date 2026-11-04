import { can, store } from "../../../app/state.js";
import { html } from "../../../shared/lib/html.js";
import { roleDescriptions, roleLabels } from "../../../shared/ui/labels.js";

const checked = (condition) => (condition ? "checked" : "");

function unknownIds(ids, list, key) {
  return ids.filter((id) => !list.some((item) => item[key] === id));
}

function groupsOf(items, orgOf, organizations) {
  const byOrg = organizations
    .map((o) => ({ id: o.id, name: o.name, items: items.filter((item) => orgOf(item) === o.id) }))
    .filter((g) => g.items.length);
  if (can.admin()) {
    const loose = items.filter((item) => !orgOf(item) || !organizations.some((o) => o.id === orgOf(item)));
    if (loose.length) byOrg.push({ id: "", name: "Sin organización", items: loose });
  }
  return byOrg;
}

function grantGroups(items, orgOf, render, { organizations, organizationIds }) {
  return groupsOf(items, orgOf, organizations).map(
    (g) =>
      html`<div class="grant-group" data-org="${g.id}" ${g.id && !organizationIds.includes(g.id) ? "hidden" : ""}><p class="grant-group-title">${g.name}</p><div class="check-list">${g.items.map(render)}</div></div>`,
  );
}

function roleStep({ role, roles, roleLocked }) {
  return html`<section data-step="role" data-title="Rol"><fieldset class="field">
      <legend>¿Qué podrá hacer?</legend>
      <div class="role-options">${roles.map((value) => html`<label class="role-option"><input type="radio" name="role" value="${value}" ${checked(value === role)} ${roleLocked ? "disabled" : ""}><span><b>${roleLabels[value]}</b><span class="muted small">${roleDescriptions[value]}</span></span></label>`)}</div>
      ${roleLocked ? html`<p class="hint">No puedes cambiar este rol aquí.</p>` : ""}
    </fieldset></section>`;
}

function organizationsStep({ organizations, organizationIds }) {
  const list = organizations.length
    ? html`<div class="check-list" role="group" aria-label="Organizaciones">${organizations.map((o) => html`<label class="checkbox"><input type="checkbox" name="organizationIds" value="${o.id}" ${checked(organizationIds.includes(o.id))}><span>${o.name}</span></label>`)}</div>`
    : html`<p class="muted small">Aún no hay organizaciones. Créalas en <a href="#/organizations">Organizaciones</a>.</p>`;
  return html`<section data-step="organizations" data-title="Organizaciones" data-grant-list><fieldset class="field"><legend>¿A qué organizaciones pertenece?</legend>
      <p class="hint">${can.admin() ? "Habilita la memoria de organización y define qué proyectos y namespaces podrás elegir después." : "Solo puedes asignar organizaciones que administras."}</p>
      ${list}
    </fieldset></section>`;
}

function projectsStep({ projects, projectIds }, context) {
  return html`<section data-step="projects" data-title="Proyectos" data-grant-list><fieldset class="field"><legend>¿En qué proyectos trabaja?</legend>
      <p class="hint">Da acceso a su memoria y ejecuciones. Se muestran los proyectos de las organizaciones elegidas.</p>
      <div data-group-list>${grantGroups(
        projects,
        (p) => p.organizationId,
        (p) =>
          html`<label class="checkbox"><input type="checkbox" name="projectIds" value="${p.id}" ${checked(projectIds.includes(p.id))}><span>${p.name} <code class="muted">${p.id}</code></span></label>`,
        context,
      )}</div>
      <p class="muted small" data-empty-hint hidden>No hay proyectos en las organizaciones elegidas. Puedes seguir sin proyectos.</p>
    </fieldset></section>`;
}

function namespaceOption(n, packageScopes) {
  return html`<label class="checkbox"><input type="checkbox" name="packageScopes" value="${n.name}" ${checked(packageScopes.includes(n.name))}><span><code>${n.name}</code>${n.visibility === "restricted" ? html` <span class="badge tone-warning">Restringido</span>` : ""}</span></label>`;
}

function namespacesStep({ namespaces, packageScopes }, context) {
  return html`<section data-step="namespaces" data-title="Namespaces" data-grant-list><fieldset class="field"><legend>¿Qué paquetes puede usar o publicar?</legend>
      <p class="hint">Con rol de publicación permite publicar en ellos. En namespaces restringidos también es lo que permite ver e instalar sus paquetes; los internos los ve todo el mundo.</p>
      ${can.admin() ? html`<label class="checkbox"><input type="checkbox" name="packageScopes" value="*" ${checked(packageScopes.includes("*"))}><span><b>Todos los namespaces</b> <code class="muted">*</code></span></label>` : ""}
      <div data-group-list>${grantGroups(
        namespaces,
        (n) => n.organizationId,
        (n) => namespaceOption(n, packageScopes),
        context,
      )}</div>
      <p class="muted small" data-empty-hint hidden>No hay namespaces en las organizaciones elegidas.</p>
    </fieldset></section>`;
}

export function grantsFields({
  role = "reader",
  projectIds = [],
  organizationIds = [],
  packageScopes = [],
  organizations = [],
  projects = [],
  namespaces = [],
  roleLocked = false,
  roles = can.assignableRoles(),
  withRole = true,
}) {
  const kept = {
    organizationIds: unknownIds(organizationIds, organizations, "id"),
    projectIds: unknownIds(projectIds, projects, "id"),
    packageScopes: unknownIds(
      packageScopes.filter((s) => s !== "*"),
      namespaces,
      "name",
    ),
  };
  const context = { organizations, organizationIds };
  return html`
    <input type="hidden" name="keptGrants" value="${JSON.stringify(kept)}">
    ${withRole ? roleStep({ role, roles, roleLocked }) : ""}
    ${organizationsStep(context)}
    ${projectsStep({ projects, projectIds }, context)}
    ${namespacesStep({ namespaces, packageScopes }, context)}`;
}

export function bindGrants(form) {
  const sync = () => {
    const chosen = new Set(
      [...form.querySelectorAll('input[name="organizationIds"]:checked')].map((input) => input.value),
    );
    form.querySelectorAll("[data-grant-list]").forEach((fieldset) => {
      const groups = [...fieldset.querySelectorAll(".grant-group")];
      groups.forEach((group) => {
        group.hidden = Boolean(group.dataset.org) && !chosen.has(group.dataset.org);
      });
      const hint = fieldset.querySelector("[data-empty-hint]");
      if (hint) hint.hidden = !groups.length || groups.some((group) => !group.hidden);
    });
  };
  form.addEventListener("change", (event) => {
    if (event.target.name === "organizationIds") sync();
  });
  sync();
}

export function readGrants(form) {
  const kept = JSON.parse(form.querySelector('input[name="keptGrants"]')?.value || "{}");
  const values = (name) =>
    [...form.querySelectorAll(`input[name="${name}"]:checked`)]
      .filter((input) => !input.closest(".grant-group")?.hidden)
      .map((input) => input.value);
  const merged = (name) => [...new Set([...values(name), ...(kept[name] || [])])];
  return {
    role: form.querySelector('input[name="role"]:checked')?.value,
    organizationIds: merged("organizationIds"),
    projectIds: merged("projectIds"),
    packageScopes: merged("packageScopes"),
  };
}

export function grantSteps(choices) {
  const names = (ids, list, key) =>
    ids.map((id) => (id === "*" ? "Todos" : list.find((item) => item[key] === id)?.name || id));
  return {
    validate: {
      role: (form) => (form.querySelector('input[name="role"]:checked') ? "" : "Elige un rol."),
      organizations: (form) =>
        !can.admin() && !readGrants(form).organizationIds.length ? "Elige al menos una organización." : "",
    },
    review: (form) => {
      const grants = readGrants(form);
      const admin = grants.role === "admin";
      return [
        ["Rol", roleLabels[grants.role]],
        ["Organizaciones", admin ? ["Todas"] : names(grants.organizationIds, choices.organizations, "id")],
        ["Proyectos", admin ? ["Todos"] : names(grants.projectIds, choices.projects, "id")],
        ["Namespaces", admin ? ["Todos"] : names(grants.packageScopes, choices.namespaces, "name")],
      ];
    },
  };
}

export async function grantChoices() {
  const [organizations, projects, namespaces] = await Promise.all([
    store.organizations(),
    store.projects(),
    store.namespaces(),
  ]);
  return {
    organizations: can.admin() ? organizations : organizations.filter((o) => o.canManage),
    projects,
    namespaces,
  };
}
