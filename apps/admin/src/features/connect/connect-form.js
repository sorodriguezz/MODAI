import { can, state } from "../../app/state.js";
import { html, mount } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { codeBlock } from "../../shared/ui/code-block.js";
import { commandLines, EDITORS, GOALS, mcpHint, mcpSnippet } from "./connect-commands.js";

const goalStep =
  () => html`<section data-step="goal" data-title="Objetivo"><fieldset class="field"><legend>¿Qué quieres hacer?</legend>
          <div class="role-options">${Object.entries(GOALS).map(([id, goal], index) => html`<label class="role-option"><input type="radio" name="goal" value="${id}" ${index === 0 ? "checked" : ""}><span><b>${icon(goal.icon, 16)} ${goal.label}</b><span class="muted small">${goal.text}</span></span></label>`)}</div>
        </fieldset></section>`;

const whereStep = () => html`<section data-step="where" data-title="Dónde"><div class="stack">
          <div class="field"><label for="connectServer">Dirección del servidor vista desde el equipo cliente</label><input id="connectServer" type="url" required value="${state.health?.publicUrl || location.origin}"><p class="hint" id="connectAddressNote"></p></div>
          <div class="field" data-when="project"><label for="connectProject">Proyecto (sistema o repositorio)</label><select id="connectProject"><option value="">Cargando…</option></select>
            <p class="hint">${can.createProject() ? html`¿No está? <a href="#/projects">Créalo en Proyectos</a> y vuelve.` : "Si no aparece, pide acceso a la administración de su organización."}</p></div>
          <div class="field-row">
            <div class="field"><label for="connectShell">Terminal del cliente</label><select id="connectShell"><option value="posix">macOS / Linux</option><option value="powershell">Windows · PowerShell</option></select></div>
            <div class="field" data-when="mcp"><label for="connectEditor">Editor o asistente</label><select id="connectEditor">${Object.entries(EDITORS).map(([id, editor]) => html`<option value="${id}">${editor.label}</option>`)}</select></div>
          </div>
          <div class="field" data-when="mcp"><label for="connectAgent">Agente que se activará (opcional)</label><select id="connectAgent"><option value="">Ninguno por ahora</option></select><p class="hint">Un agente agrupa instrucciones, skills y herramientas para un rol. Puedes activarlo después.</p></div>
        </div></section>`;

export const connectLayout = () => html`
      <div class="callout tone-info">${icon("info")}<span>La <b>CLI, el editor (MCP) y los workers</b> se conectan con una <b>API key tuya</b>: actúa en tu nombre, nunca con más permisos que tu cuenta, y la puedes revocar sin afectar tus otros equipos.</span></div>
      <form class="panel panel-body stack wizard" id="connectWizard" novalidate>
        ${goalStep()}
        ${whereStep()}
        <section data-step="credential" data-title="Credencial"><div class="stack" id="credentialStep"></div></section>
        <section data-step="commands" data-title="Comandos"><div class="stack">
          <p>Ejecuta esto en una terminal del equipo cliente. Las líneas con <code>#</code> explican el comando siguiente.</p>
          <div id="connectCommands"></div>
          <div data-when="mcp" class="stack"><h3>Conecta tu editor</h3><p class="muted" id="mcpHint"></p><div id="connectMcp"></div>
            <p class="hint">Tu asistente verá el conocimiento, la memoria, las herramientas autorizadas y el agente activo (<code>modai://agent/active</code>).</p></div>
        </div></section>
        <section data-step="verify" data-title="Verificar"><div class="stack" id="verifyStep"></div></section>
        <div class="form-error" role="alert" hidden></div>
        <div class="dialog-actions"><button type="submit" class="btn primary">${icon("check")}Terminar</button></div>
      </form>`;

export function addressNote($) {
  try {
    const host = new URL($("connectServer").value).hostname;
    $("connectAddressNote").textContent = ["localhost", "127.0.0.1", "[::1]"].includes(host)
      ? "Esta dirección solo funciona en el propio equipo del servidor. Para otros equipos usa su IP de red o dominio (MODAI_PUBLIC_URL)."
      : "Es la dirección que usarán los equipos cliente.";
  } catch {
    $("connectAddressNote").textContent = "";
  }
}

export function drawCommands(ctx) {
  const { $ } = ctx;
  try {
    const text = commandLines({
      goal: ctx.goalId(),
      server: $("connectServer").value,
      project: ctx.project()?.id,
      agent: $("connectAgent").value,
      shell: $("connectShell").value,
    });
    mount($("connectCommands"), codeBlock("connectCommandText", text, "Copiar comandos"));
  } catch (error) {
    mount(
      $("connectCommands"),
      html`<div class="callout tone-warning">${icon("alert")}<span>${error.message}</span></div>`,
    );
  }
  const editor = $("connectEditor").value;
  $("mcpHint").textContent = mcpHint(editor);
  mount($("connectMcp"), codeBlock("connectMcpText", mcpSnippet(editor), "Copiar"));
}

export function fillChoices($, projects, agents) {
  mount(
    $("connectProject"),
    html`<option value="">Elige un proyecto…</option>${projects.map((p) => html`<option value="${p.id}">${p.name}${p.organizationName ? ` · ${p.organizationName}` : ""}</option>`)}`,
  );
  mount(
    $("connectAgent"),
    html`<option value="">Ninguno por ahora</option>${agents.map((item) => html`<option value="${`${item.name}@${item.version}`}">${item.name}@${item.version}</option>`)}`,
  );
}
