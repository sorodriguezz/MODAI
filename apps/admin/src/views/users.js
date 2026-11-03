import { del, get, patch, post } from "../lib/api.js";
import { delegate, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import {
  bindForm,
  bindStrength,
  closeDialog,
  codeBlock,
  confirmDialog,
  csv,
  debounce,
  emptyState,
  errorState,
  generatePassword,
  initials,
  openDialog,
  passwordField,
  roleBadge,
  roleDescriptions,
  roleLabels,
  skeletonRows,
  strengthMeter,
  timeTag,
  toast,
} from "../lib/ui.js";
import { reviewList, wizard } from "../lib/wizard.js";
import { can, state, store } from "../state.js";

/**
 * Role + grants in hierarchical order: organizations, then the projects and namespaces of the chosen organizations.
 * Shared with API keys. Ids the lists do not know (grants the lists no longer show) are kept untouched.
 */
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
  const global = can.admin();
  const known = (ids, list, key) => ids.filter((id) => !list.some((item) => item[key] === id));
  const kept = {
    organizationIds: known(organizationIds, organizations, "id"),
    projectIds: known(projectIds, projects, "id"),
    packageScopes: known(
      packageScopes.filter((s) => s !== "*"),
      namespaces,
      "name",
    ),
  };
  const groups = (items, orgOf, render) => {
    const byOrg = organizations
      .map((o) => ({ id: o.id, name: o.name, items: items.filter((item) => orgOf(item) === o.id) }))
      .filter((g) => g.items.length);
    if (global) {
      const loose = items.filter((item) => !orgOf(item) || !organizations.some((o) => o.id === orgOf(item)));
      if (loose.length) byOrg.push({ id: "", name: "Sin organización", items: loose });
    }
    return byOrg.length
      ? byOrg.map(
          (g) =>
            html`<div class="grant-group" data-org="${g.id}" ${g.id && !organizationIds.includes(g.id) ? "hidden" : ""}><p class="grant-group-title">${g.name}</p><div class="check-list">${g.items.map(render)}</div></div>`,
        )
      : "";
  };
  return html`
    <input type="hidden" name="keptGrants" value="${JSON.stringify(kept)}">
    ${
      withRole
        ? html`<section data-step="role" data-title="Rol"><fieldset class="field">
      <legend>¿Qué podrá hacer?</legend>
      <div class="role-options">${roles.map((value) => html`<label class="role-option"><input type="radio" name="role" value="${value}" ${value === role ? "checked" : ""} ${roleLocked ? "disabled" : ""}><span><b>${roleLabels[value]}</b><span class="muted small">${roleDescriptions[value]}</span></span></label>`)}</div>
      ${roleLocked ? html`<p class="hint">No puedes cambiar este rol aquí.</p>` : ""}
    </fieldset></section>`
        : ""
    }
    <section data-step="organizations" data-title="Organizaciones" data-grant-list><fieldset class="field"><legend>¿A qué organizaciones pertenece?</legend>
      <p class="hint">${global ? "Habilita la memoria de organización y define qué proyectos y namespaces podrás elegir después." : "Solo puedes asignar organizaciones que administras."}</p>
      ${organizations.length ? html`<div class="check-list" role="group" aria-label="Organizaciones">${organizations.map((o) => html`<label class="checkbox"><input type="checkbox" name="organizationIds" value="${o.id}" ${organizationIds.includes(o.id) ? "checked" : ""}><span>${o.name}</span></label>`)}</div>` : html`<p class="muted small">Aún no hay organizaciones. Créalas en <a href="#/organizations">Organizaciones</a>.</p>`}
    </fieldset></section>
    <section data-step="projects" data-title="Proyectos" data-grant-list><fieldset class="field"><legend>¿En qué proyectos trabaja?</legend>
      <p class="hint">Da acceso a su memoria y ejecuciones. Se muestran los proyectos de las organizaciones elegidas.</p>
      <div data-group-list>${groups(
        projects,
        (p) => p.organizationId,
        (p) =>
          html`<label class="checkbox"><input type="checkbox" name="projectIds" value="${p.id}" ${projectIds.includes(p.id) ? "checked" : ""}><span>${p.name} <code class="muted">${p.id}</code></span></label>`,
      )}</div>
      <p class="muted small" data-empty-hint hidden>No hay proyectos en las organizaciones elegidas. Puedes seguir sin proyectos.</p>
    </fieldset></section>
    <section data-step="namespaces" data-title="Namespaces" data-grant-list><fieldset class="field"><legend>¿Qué paquetes puede usar o publicar?</legend>
      <p class="hint">Con rol de publicación permite publicar en ellos. En namespaces restringidos también es lo que permite ver e instalar sus paquetes; los internos los ve todo el mundo.</p>
      ${global ? html`<label class="checkbox"><input type="checkbox" name="packageScopes" value="*" ${packageScopes.includes("*") ? "checked" : ""}><span><b>Todos los namespaces</b> <code class="muted">*</code></span></label>` : ""}
      <div data-group-list>${groups(
        namespaces,
        (n) => n.organizationId,
        (n) =>
          html`<label class="checkbox"><input type="checkbox" name="packageScopes" value="${n.name}" ${packageScopes.includes(n.name) ? "checked" : ""}><span><code>${n.name}</code>${n.visibility === "restricted" ? html` <span class="badge tone-warning">Restringido</span>` : ""}</span></label>`,
      )}</div>
      <p class="muted small" data-empty-hint hidden>No hay namespaces en las organizaciones elegidas.</p>
    </fieldset></section>`;
}

/** Shows only the projects and namespaces of the checked organizations. */
export function bindGrants(form) {
  const sync = () => {
    const checked = new Set(
      [...form.querySelectorAll('input[name="organizationIds"]:checked')].map((input) => input.value),
    );
    form.querySelectorAll("[data-grant-list]").forEach((fieldset) => {
      const groups = [...fieldset.querySelectorAll(".grant-group")];
      groups.forEach((group) => {
        group.hidden = Boolean(group.dataset.org) && !checked.has(group.dataset.org);
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
  // A checked box inside a hidden group (its organization was unchecked) is not granted.
  const values = (name) =>
    [...form.querySelectorAll(`input[name="${name}"]:checked`)]
      .filter((input) => !input.closest(".grant-group")?.hidden)
      .map((input) => input.value);
  return {
    role: form.querySelector('input[name="role"]:checked')?.value,
    organizationIds: [...new Set([...values("organizationIds"), ...(kept.organizationIds || [])])],
    projectIds: [...new Set([...values("projectIds"), ...(kept.projectIds || [])])],
    packageScopes: [...new Set([...values("packageScopes"), ...(kept.packageScopes || [])])],
  };
}

/** Validators and review for the grant steps of a wizard. */
export function grantSteps(choices) {
  const names = (ids, list, key, label) =>
    ids.map((id) => (id === "*" ? "Todos" : list.find((item) => item[key] === id)?.[label] || id));
  return {
    validate: {
      role: (form) => (form.querySelector('input[name="role"]:checked') ? "" : "Elige un rol."),
      organizations: (form) =>
        !can.admin() && !readGrants(form).organizationIds.length ? "Elige al menos una organización." : "",
    },
    review: (form) => {
      const grants = readGrants(form);
      return [
        ["Rol", roleLabels[grants.role]],
        [
          "Organizaciones",
          grants.role === "admin" ? ["Todas"] : names(grants.organizationIds, choices.organizations, "id", "name"),
        ],
        ["Proyectos", grants.role === "admin" ? ["Todos"] : names(grants.projectIds, choices.projects, "id", "name")],
        [
          "Namespaces",
          grants.role === "admin" ? ["Todos"] : names(grants.packageScopes, choices.namespaces, "name", "name"),
        ],
      ];
    },
  };
}

/** Lists the grant forms choose from, by name. */
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

function userForm(user, choices, onSaved) {
  const editing = Boolean(user);
  const self = editing && user.id === state.user?.id;
  const min = state.minPasswordLength;
  const body = openDialog({
    title: editing ? "Editar " + user.username : "Nuevo usuario",
    description: editing
      ? "Los cambios de rol y permisos se aplican de inmediato, también a las sesiones abiertas."
      : "La persona podrá entrar al panel con este usuario y contraseña.",
    size: "lg",
    body: html`<form class="stack wizard" novalidate>
      <section data-step="account" data-title="Cuenta"><div class="stack">
      <div class="field-row">
        <div class="field"><label for="userUsername">Usuario</label><input id="userUsername" required minlength="3" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${user?.username || ""}" ${editing ? "disabled" : ""}>${editing ? "" : html`<p class="hint">3–64 caracteres: letras, números, punto, guion o guion bajo.</p>`}</div>
        <div class="field"><label for="userDisplay">Nombre visible</label><input id="userDisplay" maxlength="200" value="${user?.displayName || ""}" placeholder="María Pérez"></div>
      </div>
      ${
        editing
          ? ""
          : html`
        <div class="field">
          ${passwordField({ id: "userPassword", label: "Contraseña inicial", autocomplete: "new-password", minlength: min, hint: `Mínimo ${min} caracteres. Compártela por un canal privado; la persona puede cambiarla desde su menú.` })}
          ${strengthMeter("userStrength")}
          <button type="button" class="btn small ghost" data-action="generate">${icon("spark", 16)}Generar contraseña segura</button>
        </div>`
      }
      </div></section>
      ${grantsFields({ role: user?.role || "reader", projectIds: user?.projectIds, organizationIds: user?.organizationIds, packageScopes: user?.packageScopes, ...choices, roleLocked: self || (user?.role === "admin" && !can.admin()) })}
      <section data-step="review" data-title="Revisión"><p class="hint">Revisa antes de ${editing ? "guardar" : "crear la cuenta"}. Puedes volver a cualquier paso desde la barra superior.</p><div data-review></div></section>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar cambios" : "Crear usuario"}</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  if (!editing) bindStrength(form.userPassword, body.querySelector("#userStrength"));
  bindGrants(form);
  const steps = grantSteps(choices);
  wizard(form, {
    start: editing ? 1 : 0,
    validate: steps.validate,
    onEnter: {
      review: () => {
        form.querySelector("[data-review]").innerHTML = reviewList([
          ["Usuario", editing ? user.username : form.userUsername.value.trim()],
          [
            "Nombre visible",
            form.userDisplay.value.trim() || (editing ? user.displayName : form.userUsername.value.trim()),
          ],
          ...steps.review(form),
        ]);
      },
    },
  });
  delegate(body, {
    generate: () => {
      form.userPassword.value = generatePassword();
      form.userPassword.type = "text";
      form.userPassword.dispatchEvent(new Event("input"));
      form.userPassword.select();
    },
  });
  bindForm(form, async () => {
    const grants = readGrants(form);
    const displayName = form.userDisplay.value.trim();
    if (editing) {
      const payload = {
        projectIds: grants.projectIds,
        organizationIds: grants.organizationIds,
        packageScopes: grants.packageScopes,
      };
      if (!self) payload.role = grants.role;
      if (displayName) payload.displayName = displayName;
      await patch("/admin/users/" + encodeURIComponent(user.id), payload);
      toast("Usuario actualizado");
      closeDialog();
    } else {
      const password = form.userPassword.value;
      const { user: created } = await post("/admin/users", {
        username: form.userUsername.value.trim(),
        displayName: displayName || undefined,
        password,
        role: grants.role,
        projectIds: grants.projectIds,
        organizationIds: grants.organizationIds,
        packageScopes: grants.packageScopes,
      });
      showCredentials(created.username, password, "Usuario creado");
    }
    await onSaved();
  });
}

function showCredentials(username, password, title) {
  const body = openDialog({
    title,
    size: "sm",
    body: html`<div class="callout tone-warning">${icon("alert")}<span>Es la única vez que verás esta contraseña. Entrégala por un canal privado.</span></div>
      <dl class="definition-grid single"><div><dt>Panel</dt><dd>${location.origin}/admin</dd></div><div><dt>Usuario</dt><dd><code>${username}</code></dd></div></dl>
      ${codeBlock("newPasswordValue", password, "Copiar contraseña")}
      <div class="dialog-actions"><button type="button" class="btn primary" data-close>Listo</button></div>`,
  });
  body.querySelector("[data-close]").addEventListener("click", closeDialog);
}

function resetPassword(user, onSaved) {
  const min = state.minPasswordLength;
  const body = openDialog({
    title: "Restablecer contraseña",
    description: user.username + " deberá usar la nueva contraseña. Sus sesiones abiertas se cerrarán.",
    size: "sm",
    body: html`<form class="stack" novalidate>
      ${passwordField({ id: "resetPassword", label: "Nueva contraseña", autocomplete: "new-password", minlength: min, value: generatePassword() })}
      ${strengthMeter("resetStrength")}
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">Restablecer</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindStrength(form.resetPassword, body.querySelector("#resetStrength"));
  bindForm(form, async () => {
    const password = form.resetPassword.value;
    await patch("/admin/users/" + encodeURIComponent(user.id), { password });
    showCredentials(user.username, password, "Contraseña restablecida");
    await onSaved();
  });
}

export default {
  id: "users",
  label: "Usuarios",
  icon: "users",
  title: "Usuarios",
  subtitle: "Cuentas para entrar al panel. Cada persona tiene un rol y accesos por organización, proyecto y namespace.",
  visible: () => can.manageUsers(),
  async render(root, { actions, isCurrent }) {
    mount(actions, html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo usuario</button>`);
    mount(
      root,
      html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="userSearch">Buscar usuarios</label><input id="userSearch" type="search" placeholder="Buscar por usuario o nombre…"></div>
        <label class="sr-only" for="userRoleFilter">Rol</label><select id="userRoleFilter"><option value="">Todos los roles</option>${Object.entries(roleLabels).map(([value, label]) => html`<option value="${value}">${label}</option>`)}</select>
        <label class="sr-only" for="userStatusFilter">Estado</label><select id="userStatusFilter"><option value="">Activos y desactivados</option><option value="active">Solo activos</option><option value="disabled">Solo desactivados</option></select>
      </div>
      <div class="panel" id="userResults">${skeletonRows(4, 4)}</div>
      <p class="hint">Las API keys para la CLI, MCP y workers se gestionan en <a href="#/access">Accesos</a>. Un usuario del panel no sirve como credencial de la CLI.</p>`,
    );
    let users = [],
      choices = { organizations: [], projects: [], namespaces: [] };
    const orgNames = (ids) => ids.map((id) => choices.organizations.find((o) => o.id === id)?.name || id).join(", ");
    const activeAdmins = () => users.filter((u) => u.role === "admin" && !u.disabledAt).length;
    const draw = () => {
      const q = root.querySelector("#userSearch").value.trim().toLocaleLowerCase();
      const roleFilter = root.querySelector("#userRoleFilter").value,
        status = root.querySelector("#userStatusFilter").value;
      const list = users.filter(
        (u) =>
          (!roleFilter || u.role === roleFilter) &&
          (!status || (status === "active" ? !u.disabledAt : Boolean(u.disabledAt))) &&
          (!q || (u.username + " " + u.displayName).toLocaleLowerCase().includes(q)),
      );
      mount(
        root.querySelector("#userResults"),
        list.length
          ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col" class="hide-sm">Organizaciones</th><th scope="col" class="hide-sm">Proyectos</th><th scope="col" class="hide-sm">Último acceso</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map((u) => {
            const self = u.id === state.user?.id;
            const lastAdmin = u.role === "admin" && !u.disabledAt && activeAdmins() <= 1;
            return html`<tr class="${u.disabledAt ? "is-disabled" : ""}">
              <td><div class="user-cell"><span class="avatar" aria-hidden="true">${initials(u.displayName || u.username)}</span><div><b>${u.displayName}</b>${self ? html` <span class="badge tone-info">Tú</span>` : ""}<div class="muted small">@${u.username}</div></div></div></td>
              <td>${roleBadge(u.role)}</td>
              <td class="hide-sm">${u.role === "admin" ? html`<span class="muted">Todas</span>` : u.organizationIds.length ? orgNames(u.organizationIds) : html`<span class="muted">Ninguna</span>`}</td>
              <td class="hide-sm">${u.role === "admin" ? html`<span class="muted">Todos</span>` : u.projectIds.length ? u.projectIds.length : html`<span class="muted">Ninguno</span>`}</td>
              <td class="hide-sm">${timeTag(u.lastLoginAt, "Nunca")}</td>
              <td>${u.disabledAt ? html`<span class="badge tone-danger"><span class="dot"></span>Desactivado</span>` : html`<span class="badge tone-success"><span class="dot"></span>Activo</span>`}</td>
              <td class="actions">
                <button type="button" class="btn small ghost" data-action="edit" data-id="${u.id}" aria-label="Editar ${u.username}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>
                <a class="btn small ghost" href="#/access?owner=${encodeURIComponent(u.id)}" aria-label="API keys de ${u.username}">${icon("key", 16)}<span class="hide-sm">API keys</span></a>
                <button type="button" class="btn small ghost" data-action="reset" data-id="${u.id}" aria-label="Restablecer contraseña de ${u.username}">${icon("lock", 16)}<span class="hide-sm">Contraseña</span></button>
                ${
                  self
                    ? ""
                    : html`<button type="button" class="btn small ghost" data-action="toggle" data-id="${u.id}" ${lastAdmin ? "disabled" : ""} title="${lastAdmin ? "Debe quedar al menos un administrador activo" : ""}">${u.disabledAt ? "Activar" : "Desactivar"}</button>
                  <button type="button" class="icon-button small danger-text" data-action="delete" data-id="${u.id}" ${lastAdmin ? "disabled" : ""} aria-label="Eliminar ${u.username}" title="${lastAdmin ? "Debe quedar al menos un administrador activo" : "Eliminar"}">${icon("trash", 16)}</button>`
                }
              </td></tr>`;
          })}</tbody></table></div>`
          : emptyState({
              iconName: "users",
              title: users.length ? "Sin coincidencias" : "Sin usuarios",
              text: users.length ? "Cambia la búsqueda o los filtros." : "",
            }),
      );
    };
    const load = async () => {
      try {
        // Member counts per organization change with every grant.
        store.invalidate("organizations");
        const [result, loaded] = await Promise.all([get("/admin/users"), grantChoices().catch(() => choices)]);
        users = result.users;
        choices = loaded;
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#userResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#userSearch").addEventListener("input", debounce(draw));
    root.querySelector("#userRoleFilter").addEventListener("change", draw);
    root.querySelector("#userStatusFilter").addEventListener("change", draw);
    const find = (button) => users.find((u) => u.id === button.dataset.id);
    const handlers = {
      new: () => userForm(null, choices, load),
      edit: (button) => find(button) && userForm(find(button), choices, load),
      reset: (button) => find(button) && resetPassword(find(button), load),
      toggle: (button) => {
        const user = find(button);
        if (!user) return;
        const disabling = !user.disabledAt;
        confirmDialog({
          title: disabling ? "Desactivar a " + user.username : "Activar a " + user.username,
          message: disabling
            ? "No podrá iniciar sesión y sus sesiones abiertas se cerrarán. Puedes reactivarla cuando quieras."
            : "Podrá volver a iniciar sesión con su contraseña actual.",
          confirmLabel: disabling ? "Desactivar" : "Activar",
          danger: disabling,
          action: () => patch("/admin/users/" + encodeURIComponent(user.id), { disabled: disabling }),
        }).then(async (ok) => {
          if (!ok) return;
          toast(disabling ? "Usuario desactivado" : "Usuario activado");
          await load();
        });
      },
      delete: (button) => {
        const user = find(button);
        if (!user) return;
        confirmDialog({
          title: "Eliminar usuario",
          message:
            "Se eliminará la cuenta y se cerrarán sus sesiones. Su actividad seguirá en la auditoría. Los proyectos que creó no se borran.",
          typed: user.username,
          confirmLabel: "Eliminar usuario",
          action: () => del("/admin/users/" + encodeURIComponent(user.id)),
        }).then(async (ok) => {
          if (!ok) return;
          toast("Usuario eliminado");
          await load();
        });
      },
      retry: load,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
