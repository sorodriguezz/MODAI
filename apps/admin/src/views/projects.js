import { connectProject } from "./connect.js";
import { state } from "../state.js";
import { $, esc, modal, submit, notify } from "../lib/ui.js";
import { controller } from "../lib/controller.js";
import { api } from "../lib/api.js";

export function renderProjects() {
  $("projectRows").innerHTML = state.projectRecords
    .map(
      (p) =>
        "<tr><td>" +
        esc(p.name) +
        "</td><td><code>" +
        esc(p.id) +
        "</code></td><td>" +
        esc(p.organizationId || "Personal") +
        '</td><td><button class="text-button" data-project="' +
        esc(p.id) +
        '">Ver tareas</button> <button class="text-button" data-connect-project="' +
        esc(p.id) +
        '">Conectar usuario</button></td></tr>',
    )
    .join("");
  $("projectEmpty").classList.toggle("hidden", state.projectRecords.length > 0);
  $("projectRows")
    .querySelectorAll("[data-connect-project]")
    .forEach(
      (button) =>
        (button.onclick = () => connectProject(button.dataset.connectProject)),
    );
  const current = $("runProject").value;
  $("runProject").innerHTML =
    '<option value="">Selecciona un proyecto</option>' +
    state.projectRecords
      .map(
        (p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>",
      )
      .join("");
  if (state.projectRecords.some((p) => p.id === current))
    $("runProject").value = current;
  $("projectRows")
    .querySelectorAll("[data-project]")
    .forEach(
      (e) =>
        (e.onclick = () => {
          $("runProject").value = e.dataset.project;
          controller.navigate("runs");
        }),
    );
}
export function newProject() {
  modal(
    "Nuevo proyecto",
    '<form id="projectForm"><label for="projectName">Nombre</label><input id="projectName" class="full" required><label for="projectOrganization">ID de organización · opcional</label><input id="projectOrganization" class="full"><div class="dialog-foot"><button class="btn primary">Crear proyecto</button></div></form>',
  );
  $("projectForm").onsubmit = (e) => {
    e.preventDefault();
    submit(e.target, async () => {
      const { project } = await api("/projects", "POST", {
        name: $("projectName").value,
        ...($("projectOrganization").value.trim()
          ? { organizationId: $("projectOrganization").value.trim() }
          : {}),
      });
      $("modal").close();
      await controller.refresh();
      connectProject(project.id);
      notify("Proyecto creado. Ya puedes dar acceso a sus usuarios.");
    });
  };
}
