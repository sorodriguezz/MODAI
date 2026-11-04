import { get } from "../../shared/lib/api.js";
import { html, mount } from "../../shared/lib/html.js";
import { icon } from "../../shared/lib/icons.js";
import { codeBlock } from "../../shared/ui/code-block.js";
import { relativeTime } from "../../shared/ui/format.js";

const waiting = () =>
  html`<div class="callout tone-info"><span class="spinner" aria-hidden="true"></span><span>Esperando a que el cliente use la API key… Ejecuta los comandos del paso anterior; esta página se actualiza sola.</span></div>`;

const connectedMarkup = (key) =>
  html`<div class="callout tone-success">${icon("check")}<span><b>¡Conectado!</b> El cliente usó la API key ${relativeTime(key.lastUsedAt)}.</span></div><p class="hint">Ya puedes terminar.</p>`;

function manualCheck(ctx) {
  mount(
    ctx.$("verifyStep"),
    html`<p>Cuando hayas ejecutado los comandos, comprueba en el equipo cliente:</p>${codeBlock("verifyCmd", "modai server whoami", "Copiar")}<p class="hint">Debe mostrar tu credencial, su rol y ${ctx.goal().needsProject ? "el proyecto elegido" : "lo que puede hacer"}. Si falla, revisa la dirección del servidor y que la API key esté activa.</p>`,
  );
}

export async function drawVerify(ctx) {
  clearInterval(ctx.poll);
  if (!ctx.createdKey) return manualCheck(ctx);
  let connected = false;
  const check = async () => {
    try {
      const key = (await get("/me/api-keys")).keys.find((k) => k.id === ctx.createdKey.id);
      if (!ctx.isCurrent()) return clearInterval(ctx.poll);
      connected = Boolean(key?.lastUsedAt);
      if (connected) clearInterval(ctx.poll);
      mount(ctx.$("verifyStep"), connected ? connectedMarkup(key) : waiting());
    } catch (error) {
      mount(ctx.$("verifyStep"), html`<p class="muted">${error.message}</p>`);
    }
  };
  await check();
  if (!connected) ctx.poll = setInterval(check, 3000);
}
