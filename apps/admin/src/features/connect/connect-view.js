import { store } from "../../app/state.js";
import { delegate, html, mount } from "../../shared/lib/html.js";
import { wizard } from "../../shared/lib/wizard.js";
import { toast } from "../../shared/ui/toast.js";
import { GOALS, serverOrigin } from "./connect-commands.js";
import { addressNote, connectLayout, drawCommands, fillChoices } from "./connect-form.js";
import { createKey, drawCredential } from "./credential-step.js";
import { drawVerify } from "./verify-step.js";

function connectContext(root, isCurrent) {
  const form = root.querySelector("#connectWizard");
  const ctx = { root, form, isCurrent, projects: [], namespaces: [], createdKey: null, poll: null };
  ctx.$ = (id) => root.querySelector(`#${id}`);
  ctx.goalId = () => form.querySelector('input[name="goal"]:checked').value;
  ctx.goal = () => GOALS[ctx.goalId()];
  ctx.project = () => ctx.projects.find((p) => p.id === ctx.$("connectProject").value);
  return ctx;
}

function applyGoal(ctx) {
  const goal = ctx.goal();
  ctx.root.querySelectorAll('[data-when="project"]').forEach((el) => {
    el.hidden = !goal.needsProject;
  });
  ctx.root.querySelectorAll('[data-when="mcp"]').forEach((el) => {
    el.hidden = !goal.mcp;
  });
  ctx.$("connectProject").required = goal.needsProject;
}

function validateWhere(ctx) {
  try {
    serverOrigin(ctx.$("connectServer").value);
  } catch (error) {
    return error.message;
  }
  return ctx.goal().needsProject && !ctx.project() ? "Elige un proyecto." : "";
}

async function loadChoices(ctx, params) {
  try {
    const [projects, agents, namespaces] = await Promise.all([
      store.projects(),
      store.agents().catch(() => []),
      store.namespaces().catch(() => []),
    ]);
    if (!ctx.isCurrent()) return;
    ctx.projects = projects;
    ctx.namespaces = namespaces;
    fillChoices(ctx.$, projects, agents);
    const wanted = params.get("projectId");
    if (wanted && projects.some((p) => p.id === wanted)) ctx.$("connectProject").value = wanted;
  } catch (error) {
    mount(ctx.$("connectProject"), html`<option value="">${error.message}</option>`);
  }
}

export const connectView = {
  id: "connect",
  label: "Conectar un cliente",
  icon: "link",
  title: "Conectar un cliente",
  subtitle: "Un asistente que te dice exactamente qué instalar y ejecutar según lo que quieras hacer.",
  async render(root, { params, isCurrent }) {
    mount(root, connectLayout());
    const ctx = connectContext(root, isCurrent);
    const { form } = ctx;
    form.addEventListener("change", (event) => {
      if (event.target.name !== "goal") return;
      applyGoal(ctx);
      ctx.createdKey = null;
    });
    ctx.$("connectServer").addEventListener("input", () => addressNote(ctx.$));
    wizard(form, {
      validate: { where: () => validateWhere(ctx) },
      onEnter: {
        credential: () => drawCredential(ctx),
        commands: () => drawCommands(ctx),
        verify: () => drawVerify(ctx),
      },
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      clearInterval(ctx.poll);
      toast("Listo. Puedes volver a este asistente cuando quieras desde el menú de tu cuenta.", "info");
    });
    delegate(root, { createKey: (button) => createKey(ctx, button) });
    applyGoal(ctx);
    addressNote(ctx.$);
    await loadChoices(ctx, params);
  },
};
