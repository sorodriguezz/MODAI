import { can, store } from "../../../app/state.js";
import { del, get, patch } from "../../../shared/lib/api.js";
import { delegate, html, mount } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { confirmDialog } from "../../../shared/ui/dialog.js";
import { emptyState, errorState } from "../../../shared/ui/empty-state.js";
import { debounce } from "../../../shared/ui/format.js";
import { roleLabels } from "../../../shared/ui/labels.js";
import { skeletonRows } from "../../../shared/ui/skeleton.js";
import { toast } from "../../../shared/ui/toast.js";
import { grantChoices } from "./grants.js";
import { resetPassword, userForm } from "./user-form.js";
import { matchesFilters, usersTable } from "./user-table.js";

const userPath = (user) => `/admin/users/${encodeURIComponent(user.id)}`;

function toolbar() {
  return html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="userSearch">Buscar usuarios</label><input id="userSearch" type="search" placeholder="Buscar por usuario o nombre…"></div>
        <label class="sr-only" for="userRoleFilter">Rol</label><select id="userRoleFilter"><option value="">Todos los roles</option>${Object.entries(roleLabels).map(([value, label]) => html`<option value="${value}">${label}</option>`)}</select>
        <label class="sr-only" for="userStatusFilter">Estado</label><select id="userStatusFilter"><option value="">Activos y desactivados</option><option value="active">Solo activos</option><option value="disabled">Solo desactivados</option></select>
      </div>
      <div class="panel" id="userResults">${skeletonRows(4, 4)}</div>
      <p class="hint">Las API keys para la CLI, MCP y workers se gestionan en <a href="#/access">Accesos</a>. Un usuario del panel no sirve como credencial de la CLI.</p>`;
}

function toggleUser(user, load) {
  const disabling = !user.disabledAt;
  confirmDialog({
    title: disabling ? `Desactivar a ${user.username}` : `Activar a ${user.username}`,
    message: disabling
      ? "No podrá iniciar sesión y sus sesiones abiertas se cerrarán. Puedes reactivarla cuando quieras."
      : "Podrá volver a iniciar sesión con su contraseña actual.",
    confirmLabel: disabling ? "Desactivar" : "Activar",
    danger: disabling,
    action: () => patch(userPath(user), { disabled: disabling }),
  }).then(async (ok) => {
    if (!ok) return;
    toast(disabling ? "Usuario desactivado" : "Usuario activado");
    await load();
  });
}

function deleteUser(user, load) {
  confirmDialog({
    title: "Eliminar usuario",
    message:
      "Se eliminará la cuenta y se cerrarán sus sesiones. Su actividad seguirá en la auditoría. Los proyectos que creó no se borran.",
    typed: user.username,
    confirmLabel: "Eliminar usuario",
    action: () => del(userPath(user)),
  }).then(async (ok) => {
    if (!ok) return;
    toast("Usuario eliminado");
    await load();
  });
}

export const usersView = {
  id: "users",
  label: "Usuarios",
  icon: "users",
  title: "Usuarios",
  subtitle: "Cuentas para entrar al panel. Cada persona tiene un rol y accesos por organización, proyecto y namespace.",
  visible: () => can.manageUsers(),
  async render(root, { actions, isCurrent }) {
    mount(actions, html`<button class="btn primary" data-action="new">${icon("plus")}Nuevo usuario</button>`);
    mount(root, toolbar());
    let users = [];
    let choices = { organizations: [], projects: [], namespaces: [] };
    const orgNames = (ids) => ids.map((id) => choices.organizations.find((o) => o.id === id)?.name || id).join(", ");
    const draw = () => {
      const filters = {
        q: root.querySelector("#userSearch").value.trim().toLocaleLowerCase(),
        roleFilter: root.querySelector("#userRoleFilter").value,
        status: root.querySelector("#userStatusFilter").value,
      };
      const list = users.filter((u) => matchesFilters(u, filters));
      const activeAdmins = users.filter((u) => u.role === "admin" && !u.disabledAt).length;
      mount(
        root.querySelector("#userResults"),
        list.length
          ? usersTable(list, { orgNames, activeAdmins })
          : emptyState({
              iconName: "users",
              title: users.length ? "Sin coincidencias" : "Sin usuarios",
              text: users.length ? "Cambia la búsqueda o los filtros." : "",
            }),
      );
    };
    const load = async () => {
      try {
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
    const withUser = (fn) => (button) => {
      const user = users.find((u) => u.id === button.dataset.id);
      if (user) fn(user);
    };
    const handlers = {
      new: () => userForm(null, choices, load),
      edit: withUser((user) => userForm(user, choices, load)),
      reset: withUser((user) => resetPassword(user, load)),
      toggle: withUser((user) => toggleUser(user, load)),
      delete: withUser((user) => deleteUser(user, load)),
      retry: load,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
