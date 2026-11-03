import { get, post } from "../lib/api.js";
import { delegate, html, mount } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { codeBlock, relativeTime, roleLabels, toast } from "../lib/ui.js";
import { wizard } from "../lib/wizard.js";
import { can, state, store } from "../state.js";
import { keyRoles } from "./key-wizard.js";

function quote(value, shell) {
  return "'" + String(value).replaceAll("'", shell === "powershell" ? "''" : "'\\''") + "'";
}

function serverOrigin(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Usa la URL HTTP(S) del servidor, sin ruta ni credenciales.");
  return url.origin;
}

/** What the person wants to do decides the role of the API key, the commands and whether MCP is needed. */
const GOALS = {
  editor: {
    label: "Usar MODAI en mi editor",
    icon: "bot",
    role: "publisher",
    needsProject: true,
    mcp: true,
    text: "Claude Code, Cursor, VS Code… Tu asistente usa los paquetes, el conocimiento y la memoria del proyecto.",
  },
  publish: {
    label: "Publicar paquetes",
    icon: "package",
    role: "publisher",
    needsProject: false,
    mcp: false,
    text: "Subir skills, componentes o harnesses desde la terminal con modai package publish.",
  },
  worker: {
    label: "Ejecutar un worker",
    icon: "play",
    role: "worker",
    needsProject: true,
    mcp: false,
    text: "Un equipo que toma tareas de la cola de un proyecto y las ejecuta con un modelo local.",
  },
  explore: {
    label: "Solo explorar",
    icon: "search",
    role: "reader",
    needsProject: false,
    mcp: false,
    text: "Conectar la CLI para ver el catálogo y los proyectos, sin escribir nada.",
  },
};

const EDITORS = {
  "claude-code": { label: "Claude Code", file: null },
  cursor: { label: "Cursor", file: ".cursor/mcp.json" },
  vscode: { label: "VS Code", file: ".vscode/mcp.json" },
  other: { label: "Otro (JSON estándar)", file: null },
};

export function commandLines({ goal, server, project, agent, shell }) {
  const q = (value) => quote(value, shell);
  const lines = [
    ["Instala la CLI (una vez por equipo; requiere Node 26.13+)", "npm install -g @sorodriguez/modai"],
    [
      "Conecta con el servidor: pide la API key con entrada oculta y la guarda fuera del repositorio",
      "modai server connect " + q(serverOrigin(server)),
    ],
    ["Comprueba tu identidad y lo que puedes hacer", "modai server whoami"],
  ];
  if (goal === "editor") {
    lines.push([
      "En la carpeta del repositorio: vincúlalo al proyecto (si ya tiene modai.yaml, usa modai sync)",
      "modai init --project " + q(project),
    ]);
    if (agent)
      lines.push([
        "Activa el agente: instala sus instrucciones, skills y herramientas",
        "modai agent activate " + q(agent) + " --adapter agents-md --allow project.instructions",
      ]);
    lines.push(["Revisa lo instalado", "modai status"]);
  } else if (goal === "publish") {
    lines.push(
      [
        "Crea un paquete nuevo (o usa una carpeta existente)",
        "modai package scaffold ./mi-paquete --name @mi-namespace/mi-paquete",
      ],
      ["Valida su calidad", "modai package validate ./mi-paquete"],
      ["Publícalo (también acepta un archivo .skill)", "modai package publish ./mi-paquete"],
    );
  } else if (goal === "worker") {
    lines.push([
      "Toma tareas de la cola del proyecto con un modelo local (Ollama)",
      "modai agent worker --project " + q(project) + " --model MODELO_LOCAL",
    ]);
  } else {
    lines.push(["Lista los paquetes publicados", "modai registry packages"]);
  }
  return lines.map(([comment, command]) => "# " + comment + "\n" + command).join("\n\n");
}

function mcpSnippet(editor) {
  const args = ["--project", "/RUTA/ABSOLUTA/DEL/REPOSITORIO"];
  if (editor === "claude-code") return "claude mcp add modai -- modai-mcp " + args.join(" ");
  if (editor === "vscode")
    return JSON.stringify({ servers: { modai: { type: "stdio", command: "modai-mcp", args } } }, null, 2);
  return JSON.stringify({ mcpServers: { modai: { command: "modai-mcp", args } } }, null, 2);
}

export default {
  id: "connect",
  label: "Conectar un cliente",
  icon: "link",
  title: "Conectar un cliente",
  subtitle: "Un asistente que te dice exactamente qué instalar y ejecutar según lo que quieras hacer.",
  async render(root, { params, isCurrent }) {
    mount(
      root,
      html`
      <div class="callout tone-info">${icon("info")}<span>La <b>CLI, el editor (MCP) y los workers</b> se conectan con una <b>API key tuya</b>: actúa en tu nombre, nunca con más permisos que tu cuenta, y la puedes revocar sin afectar tus otros equipos.</span></div>
      <form class="panel panel-body stack wizard" id="connectWizard" novalidate>
        <section data-step="goal" data-title="Objetivo"><fieldset class="field"><legend>¿Qué quieres hacer?</legend>
          <div class="role-options">${Object.entries(GOALS).map(([id, goal], index) => html`<label class="role-option"><input type="radio" name="goal" value="${id}" ${index === 0 ? "checked" : ""}><span><b>${icon(goal.icon, 16)} ${goal.label}</b><span class="muted small">${goal.text}</span></span></label>`)}</div>
        </fieldset></section>
        <section data-step="where" data-title="Dónde"><div class="stack">
          <div class="field"><label for="connectServer">Dirección del servidor vista desde el equipo cliente</label><input id="connectServer" type="url" required value="${state.health?.publicUrl || location.origin}"><p class="hint" id="connectAddressNote"></p></div>
          <div class="field" data-when="project"><label for="connectProject">Proyecto (sistema o repositorio)</label><select id="connectProject"><option value="">Cargando…</option></select>
            <p class="hint">${can.createProject() ? html`¿No está? <a href="#/projects">Créalo en Proyectos</a> y vuelve.` : "Si no aparece, pide acceso a la administración de su organización."}</p></div>
          <div class="field-row">
            <div class="field"><label for="connectShell">Terminal del cliente</label><select id="connectShell"><option value="posix">macOS / Linux</option><option value="powershell">Windows · PowerShell</option></select></div>
            <div class="field" data-when="mcp"><label for="connectEditor">Editor o asistente</label><select id="connectEditor">${Object.entries(EDITORS).map(([id, editor]) => html`<option value="${id}">${editor.label}</option>`)}</select></div>
          </div>
          <div class="field" data-when="mcp"><label for="connectAgent">Agente que se activará (opcional)</label><select id="connectAgent"><option value="">Ninguno por ahora</option></select><p class="hint">Un agente agrupa instrucciones, skills y herramientas para un rol. Puedes activarlo después.</p></div>
        </div></section>
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
      </form>`,
    );
    const form = root.querySelector("#connectWizard");
    const $ = (id) => root.querySelector("#" + id);
    let projects = [],
      namespaces = [],
      createdKey = null,
      poll = null;
    const goalId = () => form.querySelector('input[name="goal"]:checked').value;
    const goal = () => GOALS[goalId()];
    const project = () => projects.find((p) => p.id === $("connectProject").value);

    const applyGoal = () => {
      const g = goal();
      root.querySelectorAll('[data-when="project"]').forEach((el) => {
        el.hidden = !g.needsProject;
      });
      root.querySelectorAll('[data-when="mcp"]').forEach((el) => {
        el.hidden = !g.mcp;
      });
      $("connectProject").required = g.needsProject;
    };
    const addressNote = () => {
      try {
        const host = new URL($("connectServer").value).hostname;
        $("connectAddressNote").textContent = ["localhost", "127.0.0.1", "[::1]"].includes(host)
          ? "Esta dirección solo funciona en el propio equipo del servidor. Para otros equipos usa su IP de red o dominio (MODAI_PUBLIC_URL)."
          : "Es la dirección que usarán los equipos cliente.";
      } catch {
        $("connectAddressNote").textContent = "";
      }
    };

    const drawCredential = () => {
      const g = goal(),
        p = project();
      if (createdKey) {
        mount(
          $("credentialStep"),
          html`<div class="callout tone-success">${icon("check")}<span>API key <b>${createdKey.label}</b> creada. Copia el token ahora: no se vuelve a mostrar.</span></div>${codeBlock("connectToken", createdKey.token, "Copiar token")}<p class="hint">La CLI te lo pedirá al ejecutar <code>modai server connect</code> en el paso siguiente.</p>`,
        );
        return;
      }
      // Your own key, within your account's permissions: no administrator needed unless your role falls short.
      const allowed = keyRoles(state.identity?.role);
      const role = allowed.includes(g.role)
        ? g.role
        : goalId() === "editor" && allowed.includes("reader")
          ? "reader"
          : null;
      if (!role) {
        const request = `Hola, necesito el rol «${roleLabels[g.role]}» en MODAI${p ? ` para el proyecto «${p.name}»` : ""} para ${g.label.toLowerCase()}. Mi usuario: ${state.user?.username}.`;
        mount(
          $("credentialStep"),
          html`<div class="callout tone-warning">${icon("alert")}<span>Tu cuenta tiene rol <b>${roleLabels[state.identity?.role]}</b> y para esto se necesita <b>${roleLabels[g.role]}</b>. Pide el cambio a la administración de tu organización:</span></div>${codeBlock("connectRequest", request, "Copiar mensaje")}`,
        );
        return;
      }
      const publishable = state.permissions?.publish.all
        ? namespaces.map((n) => n.name)
        : state.permissions?.publish.namespaces || [];
      mount(
        $("credentialStep"),
        html`
        <p>Crea una API key tuya para este equipo. Tendrá rol <b>${roleLabels[role]}</b>${p && g.needsProject ? html` y acceso solo al proyecto <b>${p.name}</b>` : html` y tus mismos accesos`}; nunca más que tu cuenta.</p>
        ${role !== g.role ? html`<p class="hint">Tu cuenta es de lectura: el asistente podrá consultar paquetes, conocimiento y memoria, pero no guardar memoria.</p>` : ""}
        <div class="field"><label for="connectLabel">¿Qué equipo o programa la usará?</label><input id="connectLabel" maxlength="200" placeholder="Notebook personal · Claude Code"></div>
        ${goalId() === "publish" ? html`<fieldset class="field"><legend>Namespaces donde podrá publicar</legend>${publishable.length ? html`<div class="check-list">${publishable.map((ns) => html`<label class="checkbox"><input type="checkbox" name="connectScopes" value="${ns}" checked><span><code>${ns}</code></span></label>`)}</div>` : html`<p class="muted small">Tu cuenta no puede publicar en ningún namespace. Pide acceso a la administración de su organización.</p>`}</fieldset>` : ""}
        <div class="row-actions"><button type="button" class="btn primary" data-action="createKey" data-role="${role}">${icon("key")}Crear mi API key</button></div>
        <p class="hint">¿Este equipo ya tiene una? Puedes seguir sin crear otra. Tus keys están en <a href="#/my-keys">Mis API keys</a>.</p>`,
      );
    };

    const drawCommands = () => {
      try {
        mount(
          $("connectCommands"),
          codeBlock(
            "connectCommandText",
            commandLines({
              goal: goalId(),
              server: $("connectServer").value,
              project: project()?.id,
              agent: $("connectAgent").value,
              shell: $("connectShell").value,
            }),
            "Copiar comandos",
          ),
        );
      } catch (error) {
        mount(
          $("connectCommands"),
          html`<div class="callout tone-warning">${icon("alert")}<span>${error.message}</span></div>`,
        );
      }
      const editor = $("connectEditor").value;
      $("mcpHint").textContent =
        editor === "claude-code"
          ? "Ejecuta en la carpeta del repositorio, reemplazando la ruta absoluta:"
          : EDITORS[editor].file
            ? `Guarda esto en ${EDITORS[editor].file} dentro del repositorio, reemplazando la ruta absoluta:`
            : "Añade este servidor MCP a la configuración de tu asistente, reemplazando la ruta absoluta:";
      mount($("connectMcp"), codeBlock("connectMcpText", mcpSnippet(editor), "Copiar"));
    };

    const drawVerify = async () => {
      clearInterval(poll);
      if (!createdKey) {
        mount(
          $("verifyStep"),
          html`<p>Cuando hayas ejecutado los comandos, comprueba en el equipo cliente:</p>${codeBlock("verifyCmd", "modai server whoami", "Copiar")}<p class="hint">Debe mostrar tu credencial, su rol y ${goal().needsProject ? "el proyecto elegido" : "lo que puede hacer"}. Si falla, revisa la dirección del servidor y que la API key esté activa.</p>`,
        );
        return;
      }
      let connected = false;
      const check = async () => {
        try {
          const key = (await get("/me/api-keys")).keys.find((k) => k.id === createdKey.id);
          if (!isCurrent()) return clearInterval(poll);
          connected = Boolean(key?.lastUsedAt);
          if (connected) {
            clearInterval(poll);
            mount(
              $("verifyStep"),
              html`<div class="callout tone-success">${icon("check")}<span><b>¡Conectado!</b> El cliente usó la API key ${relativeTime(key.lastUsedAt)}.</span></div><p class="hint">Ya puedes terminar.</p>`,
            );
          } else
            mount(
              $("verifyStep"),
              html`<div class="callout tone-info"><span class="spinner" aria-hidden="true"></span><span>Esperando a que el cliente use la API key… Ejecuta los comandos del paso anterior; esta página se actualiza sola.</span></div>`,
            );
        } catch (error) {
          mount($("verifyStep"), html`<p class="muted">${error.message}</p>`);
        }
      };
      await check();
      if (!connected) poll = setInterval(check, 3000);
    };

    form.addEventListener("change", (event) => {
      if (event.target.name === "goal") {
        applyGoal();
        createdKey = null;
      }
    });
    $("connectServer").addEventListener("input", addressNote);
    wizard(form, {
      validate: {
        where: () => {
          try {
            serverOrigin($("connectServer").value);
          } catch (error) {
            return error.message;
          }
          return goal().needsProject && !project() ? "Elige un proyecto." : "";
        },
      },
      onEnter: { credential: drawCredential, commands: drawCommands, verify: drawVerify },
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      clearInterval(poll);
      toast("Listo. Puedes volver a este asistente cuando quieras desde el menú de tu cuenta.", "info");
    });
    delegate(root, {
      createKey: async (button) => {
        const p = project(),
          g = goal();
        const label = $("connectLabel").value.trim() || `${g.label} · ${p?.name || "equipo"}`;
        const packageScopes = [...form.querySelectorAll('input[name="connectScopes"]:checked')].map(
          (input) => input.value,
        );
        const scoped = (p && g.needsProject) || packageScopes.length;
        const access = scoped
          ? {
              inherit: false,
              projectIds: p && g.needsProject ? [p.id] : [],
              organizationIds: p?.organizationId ? [p.organizationId] : [],
              packageScopes,
            }
          : { inherit: true };
        button.disabled = true;
        try {
          const { key } = await post("/me/api-keys", { label, role: button.dataset.role, ...access });
          createdKey = key;
          drawCredential();
        } catch (error) {
          button.disabled = false;
          const box = form.querySelector(".form-error");
          box.textContent = error.message;
          box.hidden = false;
        }
      },
    });

    applyGoal();
    addressNote();
    try {
      const [projectList, agents, namespaceList] = await Promise.all([
        store.projects(),
        store.agents().catch(() => []),
        store.namespaces().catch(() => []),
      ]);
      if (!isCurrent()) return;
      projects = projectList;
      namespaces = namespaceList;
      mount(
        $("connectProject"),
        html`<option value="">Elige un proyecto…</option>${projects.map((p) => html`<option value="${p.id}">${p.name}${p.organizationName ? " · " + p.organizationName : ""}</option>`)}`,
      );
      mount(
        $("connectAgent"),
        html`<option value="">Ninguno por ahora</option>${agents.map((item) => html`<option value="${item.name + "@" + item.version}">${item.name}@${item.version}</option>`)}`,
      );
      const wanted = params.get("projectId");
      if (wanted && projects.some((p) => p.id === wanted)) $("connectProject").value = wanted;
    } catch (error) {
      mount($("connectProject"), html`<option value="">${error.message}</option>`);
    }
  },
};
