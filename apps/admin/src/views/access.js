import { state } from "../state.js";
import {
  $,
  esc,
  date,
  confirmAction,
  notify,
  modal,
  submit,
} from "../lib/ui.js";
import { api } from "../lib/api.js";
import { controller } from "../lib/controller.js";

export async function loadKeys() {
  try {
    const d = await api("/admin/api-keys");
    state.keyRecords = d.keys;
    $("keyEmpty").classList.toggle("hidden", d.keys.length > 0);
    $("keyEmpty").textContent =
      "Aún no hay API keys. Crea una para cada cliente.";
    $("keyRows").innerHTML = d.keys
      .map(
        (k) =>
          "<tr><td>" +
          (k.revokedAt
            ? esc(k.label)
            : '<button class="text-button" data-key="' +
              esc(k.id) +
              '">' +
              esc(k.label) +
              "</button>") +
          '</td><td><span class="badge">' +
          esc(k.role) +
          '</span></td><td class="muted">' +
          date(k.lastUsedAt) +
          '</td><td><span class="badge ' +
          (k.revokedAt ? "yanked" : "active") +
          '">' +
          (k.revokedAt ? "Revocada" : "Activa") +
          "</span></td><td>" +
          (!k.revokedAt
            ? '<button class="text-button" data-revoke="' +
              esc(k.id) +
              '">Revocar</button>'
            : "") +
          "</td></tr>",
      )
      .join("");
    $("keyRows")
      .querySelectorAll("[data-key]")
      .forEach((e) => (e.onclick = () => editKeyGrants(e.dataset.key)));
    $("keyRows")
      .querySelectorAll("[data-revoke]")
      .forEach(
        (e) =>
          (e.onclick = () =>
            confirmAction(
              "Revocar API key",
              "Los clientes que usen esta credencial perderán el acceso.",
              async () => {
                await api("/admin/api-keys/" + e.dataset.revoke, "DELETE");
                await controller.refresh();
                await loadKeys();
                notify("API key revocada");
              },
            )),
      );
  } catch (e) {
    $("keyRows").innerHTML = "";
    $("keyEmpty").classList.remove("hidden");
    $("keyEmpty").textContent = e.message;
  }
}
export function editKeyGrants(id) {
  const key = state.keyRecords.find((k) => k.id === id);
  if (!key) return;
  modal(
    "Permisos de " + key.label,
    '<form id="grantForm"><label for="grantProjects">IDs de proyectos separados por comas</label><input id="grantProjects" class="full" value="' +
      esc((key.projectIds || []).join(", ")) +
      '"><label for="grantOrganizations">IDs de organizaciones</label><input id="grantOrganizations" class="full" value="' +
      esc((key.organizationIds || []).join(", ")) +
      '"><label for="grantScopes">Namespaces publicables</label><input id="grantScopes" class="full" value="' +
      esc((key.packageScopes || []).join(", ")) +
      '"><div class="dialog-foot"><button class="btn primary">Guardar permisos</button></div></form>',
  );
  $("grantForm").onsubmit = (e) => {
    e.preventDefault();
    submit(e.target, async () => {
      await api("/admin/api-keys/" + encodeURIComponent(id), "PATCH", {
        projectIds: csv($("grantProjects").value),
        organizationIds: csv($("grantOrganizations").value),
        packageScopes: csv($("grantScopes").value),
      });
      $("modal").close();
      await loadKeys();
      notify("Permisos actualizados");
    });
  };
}
export function newKey() {
  modal(
    "Crear API key",
    '<p>Autoriza cada cliente para los proyectos y namespaces que necesita.</p><form id="keyForm"><label for="keyLabel">Nombre del cliente</label><input id="keyLabel" class="full" required><label for="keyRole">Permisos</label><select id="keyRole" class="full"><option value="reader">Lectura</option><option value="publisher">Publicación y tareas</option><option value="worker">Worker de ejecución</option><option value="admin">Administración completa</option></select><label for="keyProjects">IDs de proyectos separados por comas</label><input id="keyProjects" class="full" placeholder="Sin proyectos: no accede a su memoria ni tareas"><label for="keyOrganizations">IDs de organizaciones compartidas</label><input id="keyOrganizations" class="full"><label for="keyScopes">Namespaces publicables separados por comas</label><input id="keyScopes" class="full" placeholder="@skills, @agents"><div class="dialog-foot"><button class="btn primary">Crear credencial</button></div></form>',
  );
  $("keyForm").onsubmit = (e) => {
    e.preventDefault();
    submit(e.target, async () => {
      const key = (
        await api("/admin/api-keys", "POST", {
          label: $("keyLabel").value,
          role: $("keyRole").value,
          projectIds: csv($("keyProjects").value),
          organizationIds: csv($("keyOrganizations").value),
          packageScopes: csv($("keyScopes").value),
        })
      ).key;
      modal(
        "Guarda tu nueva API key",
        '<div class="notice">Solo verás este token ahora. Guárdalo antes de cerrar.</div><pre id="newSecret">' +
          esc(key.token) +
          '</pre><div class="dialog-foot"><button class="btn primary" data-copy="newSecret">Copiar token</button></div>',
      );
      await loadKeys();
    });
  };
}
export function openConnection() {
  modal(
    "Conexión al servidor",
    "<p>Servidor actual: <b>" +
      esc(location.origin) +
      '</b></p><p>Usa tu API key o el token de administración.</p><form id="connectionForm"><label for="tokenInput">Token de acceso</label><input type="password" autocomplete="off" id="tokenInput" class="full" placeholder="Pega aquí tu token" value="' +
      esc(state.token) +
      '"><p class="small">Se conserva solo en esta sesión del navegador.</p><div class="dialog-foot"><button type="button" class="btn" data-click="disconnect">Olvidar token</button><button class="btn primary" type="submit">Conectar</button></div></form>',
  );
  $("connectionForm").onsubmit = (e) => {
    e.preventDefault();
    submit(e.target, async () => {
      const previous = state.token;
      state.token = $("tokenInput").value.trim();
      try {
        await api("/session");
        sessionStorage.setItem("modai-token", state.token);
        $("modal").close();
        await controller.refresh();
        notify("Conexión establecida");
      } catch (err) {
        state.token = previous;
        throw err;
      }
    });
  };
}
export function disconnect() {
  state.token = "";
  sessionStorage.removeItem("modai-token");
  $("modal").close();
  controller.refresh();
}
export function csv(value) {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
