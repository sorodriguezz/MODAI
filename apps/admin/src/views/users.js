import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get, post, patch, del } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, confirmDialog, toast, skeletonRows, emptyState, errorState, timeTag, roleBadge, roleLabels, roleDescriptions, csv, debounce, passwordField, strengthMeter, bindStrength, generatePassword, codeBlock, initials } from "../lib/ui.js";
import { state, store, can } from "../state.js";

/** Role radio cards + grants (projects checklist, organizations, package scopes). Shared with API keys. */
export function grantsFields({ role = "reader", projectIds = [], organizationIds = [], packageScopes = [], projects = [], roleLocked = false, roles = ["reader", "publisher", "worker", "admin"] }) {
  const unknown = projectIds.filter((id) => !projects.some((p) => p.id === id));
  return html`
    <fieldset class="field">
      <legend>Rol</legend>
      <div class="role-options">${roles.map((value) => html`<label class="role-option"><input type="radio" name="role" value="${value}" ${value === role ? "checked" : ""} ${roleLocked ? "disabled" : ""}><span><b>${roleLabels[value]}</b><span class="muted small">${roleDescriptions[value]}</span></span></label>`)}</div>
      ${roleLocked ? html`<p class="hint">No puedes cambiar tu propio rol.</p>` : ""}
    </fieldset>
    <fieldset class="field" data-grants>
      <legend>Proyectos con acceso</legend>
      <p class="hint">La administración accede a todo. El resto ve los proyectos marcados y los que cree.</p>
      ${projects.length ? html`<div class="check-list" role="group" aria-label="Proyectos">${projects.map((p) => html`<label class="checkbox"><input type="checkbox" name="projectIds" value="${p.id}" ${projectIds.includes(p.id) ? "checked" : ""}><span>${p.name} <code class="muted">${p.id}</code></span></label>`)}</div>` : html`<p class="muted small">Aún no hay proyectos.</p>`}
      <div class="field"><label for="extraProjects">Otros IDs de proyecto</label><input id="extraProjects" value="${unknown.join(", ")}" placeholder="Separados por comas"></div>
    </fieldset>
    <div class="field-row">
      <div class="field"><label for="grantOrganizations">Organizaciones</label><input id="grantOrganizations" value="${organizationIds.join(", ")}" placeholder="IDs separados por comas"><p class="hint">Habilita la memoria de organización.</p></div>
      <div class="field"><label for="grantScopes">Namespaces publicables</label><input id="grantScopes" value="${packageScopes.join(", ")}" placeholder="@equipo, @skills" pattern="^\\s*(\\*|@[a-z0-9][a-z0-9._\\-]*)(\\s*,\\s*(\\*|@[a-z0-9][a-z0-9._\\-]*))*\\s*$"><p class="hint">Para publicar paquetes. Usa * para todos.</p></div>
    </div>`;
}

export function readGrants(form) {
  return {
    role: form.querySelector('input[name="role"]:checked')?.value,
    projectIds: [...new Set([...[...form.querySelectorAll('input[name="projectIds"]:checked')].map((input) => input.value), ...csv(form.extraProjects.value)])],
    organizationIds: csv(form.grantOrganizations.value),
    packageScopes: csv(form.grantScopes.value),
  };
}

function userForm(user, projects, onSaved) {
  const editing = Boolean(user);
  const self = editing && user.id === state.user?.id;
  const min = state.minPasswordLength;
  const body = openDialog({
    title: editing ? "Editar " + user.username : "Nuevo usuario",
    description: editing ? "Los cambios de rol y permisos se aplican de inmediato, también a las sesiones abiertas." : "La persona podrá entrar al panel con este usuario y contraseña.",
    size: "lg",
    body: html`<form class="stack" novalidate>
      <div class="field-row">
        <div class="field"><label for="userUsername">Usuario</label><input id="userUsername" required minlength="3" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}" autocomplete="off" autocapitalize="off" spellcheck="false" value="${user?.username || ""}" ${editing ? "disabled" : ""}>${editing ? "" : html`<p class="hint">3–64 caracteres: letras, números, punto, guion o guion bajo.</p>`}</div>
        <div class="field"><label for="userDisplay">Nombre visible</label><input id="userDisplay" maxlength="200" value="${user?.displayName || ""}" placeholder="María Pérez"></div>
      </div>
      ${editing ? "" : html`
        <div class="field">
          ${passwordField({ id: "userPassword", label: "Contraseña inicial", autocomplete: "new-password", minlength: min, hint: `Mínimo ${min} caracteres. Compártela por un canal privado; la persona puede cambiarla desde su menú.` })}
          ${strengthMeter("userStrength")}
          <button type="button" class="btn small ghost" data-action="generate">${icon("spark", 16)}Generar contraseña segura</button>
        </div>`}
      ${grantsFields({ role: user?.role || "reader", projectIds: user?.projectIds, organizationIds: user?.organizationIds, packageScopes: user?.packageScopes, projects, roleLocked: self })}
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar cambios" : "Crear usuario"}</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  if (!editing) bindStrength(form.userPassword, body.querySelector("#userStrength"));
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
      const payload = { projectIds: grants.projectIds, organizationIds: grants.organizationIds, packageScopes: grants.packageScopes };
      if (!self) payload.role = grants.role;
      if (displayName) payload.displayName = displayName;
      await patch("/admin/users/" + encodeURIComponent(user.id), payload);
      toast("Usuario actualizado");
      closeDialog();
    } else {
      const password = form.userPassword.value;
      const { user: created } = await post("/admin/users", { username: form.userUsername.value.trim(), displayName: displayName || undefined, password, role: grants.role, projectIds: grants.projectIds, organizationIds: grants.organizationIds, packageScopes: grants.packageScopes });
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
  subtitle: "Cuentas para entrar al panel. Cada persona tiene su rol y sus proyectos.",
  visible: () => can.admin(),
  async render(root, { actions, isCurrent }) {
    mount(actions, html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo usuario</button>`);
    mount(root, html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="userSearch">Buscar usuarios</label><input id="userSearch" type="search" placeholder="Buscar por usuario o nombre…"></div>
        <label class="sr-only" for="userRoleFilter">Rol</label><select id="userRoleFilter"><option value="">Todos los roles</option>${Object.entries(roleLabels).map(([value, label]) => html`<option value="${value}">${label}</option>`)}</select>
        <label class="sr-only" for="userStatusFilter">Estado</label><select id="userStatusFilter"><option value="">Activos y desactivados</option><option value="active">Solo activos</option><option value="disabled">Solo desactivados</option></select>
      </div>
      <div class="panel" id="userResults">${skeletonRows(4, 4)}</div>
      <p class="hint">Las API keys para la CLI, MCP y workers se gestionan en <a href="#/access">Accesos</a>. Un usuario del panel no sirve como credencial de la CLI.</p>`);
    let users = [], projects = [];
    const activeAdmins = () => users.filter((u) => u.role === "admin" && !u.disabledAt).length;
    const draw = () => {
      const q = root.querySelector("#userSearch").value.trim().toLocaleLowerCase();
      const roleFilter = root.querySelector("#userRoleFilter").value, status = root.querySelector("#userStatusFilter").value;
      const list = users.filter((u) => (!roleFilter || u.role === roleFilter) && (!status || (status === "active" ? !u.disabledAt : Boolean(u.disabledAt))) && (!q || (u.username + " " + u.displayName).toLocaleLowerCase().includes(q)));
      mount(root.querySelector("#userResults"), list.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Usuario</th><th scope="col">Rol</th><th scope="col" class="hide-sm">Proyectos</th><th scope="col" class="hide-sm">Último acceso</th><th scope="col">Estado</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map((u) => {
            const self = u.id === state.user?.id;
            const lastAdmin = u.role === "admin" && !u.disabledAt && activeAdmins() <= 1;
            return html`<tr class="${u.disabledAt ? "is-disabled" : ""}">
              <td><div class="user-cell"><span class="avatar" aria-hidden="true">${initials(u.displayName || u.username)}</span><div><b>${u.displayName}</b>${self ? html` <span class="badge tone-info">Tú</span>` : ""}<div class="muted small">@${u.username}</div></div></div></td>
              <td>${roleBadge(u.role)}</td>
              <td class="hide-sm">${u.role === "admin" ? html`<span class="muted">Todos</span>` : u.projectIds.length ? u.projectIds.length : html`<span class="muted">Ninguno</span>`}</td>
              <td class="hide-sm">${timeTag(u.lastLoginAt, "Nunca")}</td>
              <td>${u.disabledAt ? html`<span class="badge tone-danger"><span class="dot"></span>Desactivado</span>` : html`<span class="badge tone-success"><span class="dot"></span>Activo</span>`}</td>
              <td class="actions">
                <button type="button" class="btn small ghost" data-action="edit" data-id="${u.id}" aria-label="Editar ${u.username}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>
                <button type="button" class="btn small ghost" data-action="reset" data-id="${u.id}" aria-label="Restablecer contraseña de ${u.username}">${icon("lock", 16)}<span class="hide-sm">Contraseña</span></button>
                ${self ? "" : html`<button type="button" class="btn small ghost" data-action="toggle" data-id="${u.id}" ${lastAdmin ? "disabled" : ""} title="${lastAdmin ? "Debe quedar al menos un administrador activo" : ""}">${u.disabledAt ? "Activar" : "Desactivar"}</button>
                  <button type="button" class="icon-button small danger-text" data-action="delete" data-id="${u.id}" ${lastAdmin ? "disabled" : ""} aria-label="Eliminar ${u.username}" title="${lastAdmin ? "Debe quedar al menos un administrador activo" : "Eliminar"}">${icon("trash", 16)}</button>`}
              </td></tr>`;
          })}</tbody></table></div>`
        : emptyState({ iconName: "users", title: users.length ? "Sin coincidencias" : "Sin usuarios", text: users.length ? "Cambia la búsqueda o los filtros." : "" }));
    };
    const load = async () => {
      try {
        const [result, projectList] = await Promise.all([get("/admin/users"), store.projects().catch(() => [])]);
        users = result.users;
        projects = projectList;
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
      new: () => userForm(null, projects, load),
      edit: (button) => find(button) && userForm(find(button), projects, load),
      reset: (button) => find(button) && resetPassword(find(button), load),
      toggle: (button) => {
        const user = find(button);
        if (!user) return;
        const disabling = !user.disabledAt;
        confirmDialog({
          title: disabling ? "Desactivar a " + user.username : "Activar a " + user.username,
          message: disabling ? "No podrá iniciar sesión y sus sesiones abiertas se cerrarán. Puedes reactivarla cuando quieras." : "Podrá volver a iniciar sesión con su contraseña actual.",
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
          message: "Se eliminará la cuenta y se cerrarán sus sesiones. Su actividad seguirá en la auditoría. Los proyectos que creó no se borran.",
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
