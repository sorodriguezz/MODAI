import { del, get, post, put } from "../../shared/lib/api.js";
import { delegate, html, mount } from "../../shared/lib/html.js";
import { confirmDialog } from "../../shared/ui/dialog.js";
import { errorState } from "../../shared/ui/empty-state.js";
import { bindForm } from "../../shared/ui/form.js";
import { toast, toastError } from "../../shared/ui/toast.js";

function memberEditor(members, candidates) {
  return html`<div class="stack">
    <h3>Integrantes del equipo</h3>
    ${
      members.length
        ? html`<ul>${members.map(
            (member) => html`<li>${member.username}${member.active ? "" : " · Inactivo"}
    <button type="button" class="btn small ghost danger-text" data-action="remove-member" data-id="${member.id}" aria-label="Quitar a ${member.username}">Quitar</button></li>`,
          )}</ul>`
        : html`<p class="muted">El equipo no tiene integrantes.</p>`
    }
    ${
      candidates.length
        ? html`<form class="stack" novalidate>
      <div class="field"><label for="profileTeamMember">Usuario de la organización</label><select id="profileTeamMember" required>
      <option value="">Selecciona un usuario</option>${candidates.map((user) => html`<option value="${user.id}">${user.displayName} · ${user.username}</option>`)}</select></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="submit" class="btn">Agregar integrante</button></div>
    </form>`
        : ""
    }
  </div>`;
}

export async function renderTeams(root, project, reopen) {
  const path = `/organizations/${encodeURIComponent(project.organizationId)}/teams`;
  const [{ teams }, { users }] = await Promise.all([get(path), get("/admin/users")]);
  const eligible = users.filter((user) => !user.disabledAt && user.organizationIds.includes(project.organizationId));
  mount(
    root,
    html`<div class="stack">
    <p class="muted">Los equipos y sus asignaciones se comparten entre los proyectos de ${project.organizationName || "esta organización"}.</p>
    ${
      teams.length
        ? html`<div class="field-row">
      <div class="field"><label for="profileTeam">Equipo</label><select id="profileTeam">${teams.map((team) => html`<option value="${team.id}">${team.name}</option>`)}</select></div>
      <button type="button" class="btn ghost danger-text" data-action="delete-team">Eliminar equipo</button>
    </div><div data-team-members></div>`
        : html`<p class="muted">La organización no tiene equipos.</p>`
    }
    <form data-create-team class="stack" novalidate>
      <h3>Nuevo equipo</h3>
      <div class="field"><label for="profileTeamName">Nombre del equipo</label><input id="profileTeamName" required maxlength="200"></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="submit" class="btn primary">Crear equipo</button></div>
    </form>
  </div>`,
  );
  const create = root.querySelector("[data-create-team]");
  bindForm(create, async () => {
    await post(path, { name: create.profileTeamName.value.trim() });
    toast("Equipo creado");
    if (root.isConnected) await renderTeams(root, project, reopen);
  });
  if (!teams.length) return;
  const select = root.querySelector("#profileTeam");
  const members = root.querySelector("[data-team-members]");
  const memberPath = () => `/teams/${encodeURIComponent(select.value)}/members`;
  let revision = 0;
  const refresh = async () => {
    const current = ++revision;
    const membersUrl = memberPath();
    mount(members, html`<p class="muted" role="status">Cargando integrantes…</p>`);
    try {
      const result = await get(membersUrl);
      if (current !== revision) return;
      const enrolled = new Set(result.members.map((item) => item.id));
      mount(
        members,
        memberEditor(
          result.members,
          eligible.filter((item) => !enrolled.has(item.id)),
        ),
      );
      const form = members.querySelector("form");
      if (form)
        bindForm(form, async () => {
          await put(`${membersUrl}/${encodeURIComponent(form.profileTeamMember.value)}`);
          toast("Integrante agregado");
          if (form.isConnected) await refresh();
        });
    } catch (error) {
      if (current === revision) mount(members, errorState(error));
    }
  };
  select.addEventListener("change", refresh);
  delegate(root.firstElementChild, {
    "remove-member": async (button) => {
      try {
        button.disabled = true;
        const target = memberPath();
        await del(`${target}/${encodeURIComponent(button.dataset.id)}`);
        toast("Integrante retirado");
        if (members.isConnected && target === memberPath()) await refresh();
      } catch (error) {
        toastError(error);
        button.disabled = false;
      }
    },
    "delete-team": async () => {
      const team = teams.find((item) => item.id === select.value);
      const removed = await confirmDialog({
        title: "Eliminar equipo",
        message: html`Se eliminará <b>${team.name}</b> junto con sus integrantes y asignaciones de capacidades.`,
        confirmLabel: "Eliminar equipo",
        action: () => del(`/teams/${encodeURIComponent(team.id)}`),
      });
      if (removed) toast("Equipo eliminado");
      reopen();
    },
  });
  await refresh();
}
