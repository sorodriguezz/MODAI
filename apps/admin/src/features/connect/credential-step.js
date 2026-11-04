import { state } from "../../app/state.js";
import { post } from "../../shared/lib/api.js";
import { html, mount } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { codeBlock } from "../../shared/ui/code-block.js";
import { roleLabels } from "../../shared/ui/labels.js";
import { keyRoles } from "../keys/key-wizard.js";

function keyRole(goal, goalId) {
  const allowed = keyRoles(state.identity?.role);
  if (allowed.includes(goal.role)) return goal.role;
  return goalId === "editor" && allowed.includes("reader") ? "reader" : null;
}

function createdMarkup(key) {
  return html`<div class="callout tone-success">${icon("check")}<span>API key <b>${key.label}</b> creada. Copia el token ahora: no se vuelve a mostrar.</span></div>${codeBlock("connectToken", key.token, "Copiar token")}<p class="hint">La CLI te lo pedirá al ejecutar <code>modai server connect</code> en el paso siguiente.</p>`;
}

function missingRoleMarkup(goal, project) {
  const request = `Hola, necesito el rol «${roleLabels[goal.role]}» en MODAI${project ? ` para el proyecto «${project.name}»` : ""} para ${goal.label.toLowerCase()}. Mi usuario: ${state.user?.username}.`;
  return html`<div class="callout tone-warning">${icon("alert")}<span>Tu cuenta tiene rol <b>${roleLabels[state.identity?.role]}</b> y para esto se necesita <b>${roleLabels[goal.role]}</b>. Pide el cambio a la administración de tu organización:</span></div>${codeBlock("connectRequest", request, "Copiar mensaje")}`;
}

function scopesField(namespaces) {
  const publishable = state.permissions?.publish.all
    ? namespaces.map((n) => n.name)
    : state.permissions?.publish.namespaces || [];
  const choices = publishable.length
    ? html`<div class="check-list">${publishable.map((ns) => html`<label class="checkbox"><input type="checkbox" name="connectScopes" value="${ns}" checked><span><code>${ns}</code></span></label>`)}</div>`
    : html`<p class="muted small">Tu cuenta no puede publicar en ningún namespace. Pide acceso a la administración de su organización.</p>`;
  return html`<fieldset class="field"><legend>Namespaces donde podrá publicar</legend>${choices}</fieldset>`;
}

function createMarkup({ role, goal, goalId, project, namespaces }) {
  return html`
        <p>Crea una API key tuya para este equipo. Tendrá rol <b>${roleLabels[role]}</b>${project && goal.needsProject ? html` y acceso solo al proyecto <b>${project.name}</b>` : html` y tus mismos accesos`}; nunca más que tu cuenta.</p>
        ${role !== goal.role ? html`<p class="hint">Tu cuenta es de lectura: el asistente podrá consultar paquetes, conocimiento y memoria, pero no guardar memoria.</p>` : ""}
        <div class="field"><label for="connectLabel">¿Qué equipo o programa la usará?</label><input id="connectLabel" maxlength="200" placeholder="Notebook personal · Claude Code"></div>
        ${goalId === "publish" ? scopesField(namespaces) : ""}
        <div class="row-actions"><button type="button" class="btn primary" data-action="createKey" data-role="${role}">${icon("key")}Crear mi API key</button></div>
        <p class="hint">¿Este equipo ya tiene una? Puedes seguir sin crear otra. Tus keys están en <a href="#/my-keys">Mis API keys</a>.</p>`;
}

export function drawCredential(ctx) {
  const step = ctx.$("credentialStep");
  if (ctx.createdKey) return mount(step, createdMarkup(ctx.createdKey));
  const goal = ctx.goal();
  const project = ctx.project();
  const role = keyRole(goal, ctx.goalId());
  if (!role) return mount(step, missingRoleMarkup(goal, project));
  mount(step, createMarkup({ role, goal, goalId: ctx.goalId(), project, namespaces: ctx.namespaces }));
}

function keyAccess(project, goal, packageScopes) {
  const withProject = Boolean(project && goal.needsProject);
  if (!withProject && !packageScopes.length) return { inherit: true };
  return {
    inherit: false,
    projectIds: withProject ? [project.id] : [],
    organizationIds: project?.organizationId ? [project.organizationId] : [],
    packageScopes,
  };
}

export async function createKey(ctx, button) {
  const project = ctx.project();
  const goal = ctx.goal();
  const label = ctx.$("connectLabel").value.trim() || `${goal.label} · ${project?.name || "equipo"}`;
  const packageScopes = [...ctx.form.querySelectorAll('input[name="connectScopes"]:checked')].map(
    (input) => input.value,
  );
  button.disabled = true;
  try {
    const { key } = await post("/me/api-keys", {
      label,
      role: button.dataset.role,
      ...keyAccess(project, goal, packageScopes),
    });
    ctx.createdKey = key;
    drawCredential(ctx);
  } catch (error) {
    button.disabled = false;
    const box = ctx.form.querySelector(".form-error");
    box.textContent = error.message;
    box.hidden = false;
  }
}
