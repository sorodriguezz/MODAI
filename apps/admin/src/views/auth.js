import { html, mount, $ } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post } from "../lib/api.js";
import { bindForm, passwordField, strengthMeter, bindStrength } from "../lib/ui.js";
import { state } from "../state.js";

function themeSwitcher() {
  return html`<label class="sr-only" for="authTheme">Tema de apariencia</label>
    <select id="authTheme" class="theme-select">
      <option value="system">Sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option>
    </select>`;
}

function frame(content) {
  return html`<div class="auth-layout">
    <section class="auth-aside" aria-hidden="true">
      <div class="auth-brand"><span class="logo-mark">M</span><span>MODAI</span></div>
      <div class="auth-pitch">
        <h2>Capacidades componibles para tus agentes.</h2>
        <p>Paquetes, conocimiento y memoria compartida en un servidor ligero. Los modelos siguen en tus equipos.</p>
        <ul class="auth-points">
          <li>${icon("package")}Catálogo versionado de skills, herramientas y agentes</li>
          <li>${icon("brain")}Memoria por proyecto que sobrevive a cada sesión</li>
          <li>${icon("shield")}Roles, API keys individuales y auditoría</li>
        </ul>
      </div>
      <p class="auth-foot">${state.health ? html`Servidor MODAI ${state.health.version}` : ""}</p>
    </section>
    <section class="auth-main">
      <div class="auth-top">${themeSwitcher()}</div>
      <div class="auth-card">${content}</div>
      <p class="auth-legal">Acceso restringido. Toda actividad queda registrada.</p>
    </section>
  </div>`;
}

function bindTheme(root) {
  const select = root.querySelector("#authTheme");
  select.value = window.modaiTheme.get();
  select.addEventListener("change", () => {
    window.modaiTheme.set(select.value);
    const main = $("themeSelect");
    if (main) main.value = select.value;
  });
}

/** Login screen. `onSuccess(user)` is called after the session cookie is set. */
export function renderLogin({ onSuccess, notice }) {
  const root = $("authScreen");
  mount(root, frame(html`
    <div class="auth-card-head">
      <span class="logo-mark mobile-only" aria-hidden="true">M</span>
      <h1>Inicia sesión</h1>
      <p>Usa tu usuario del panel de MODAI.</p>
    </div>
    ${notice ? html`<div class="callout tone-info" role="status">${icon("info")}<span>${notice}</span></div>` : ""}
    <form id="loginForm" class="stack" novalidate>
      <div class="field">
        <label for="loginUsername">Usuario</label>
        <input id="loginUsername" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required maxlength="64" autofocus>
      </div>
      ${passwordField({ id: "loginPassword", label: "Contraseña", autocomplete: "current-password" })}
      <div class="form-error" role="alert" hidden></div>
      <button class="btn primary block large" type="submit"><span class="btn-label">Entrar</span></button>
    </form>
    <details class="auth-help">
      <summary>¿No puedes entrar?</summary>
      <p>Pide a una persona administradora que restablezca tu contraseña desde <b>Usuarios</b>. Las API keys sirven para la CLI y MCP, no para este panel.</p>
    </details>
  `));
  bindTheme(root);
  const form = root.querySelector("#loginForm");
  bindForm(form, async () => {
    let user;
    try {
      ({ user } = await post("/auth/login", { username: form.loginUsername.value.trim(), password: form.loginPassword.value }));
    } catch (error) {
      // Keep the username, clear the password and return focus to it.
      form.loginPassword.value = "";
      requestAnimationFrame(() => form.loginPassword.focus());
      throw error;
    }
    form.loginPassword.value = "";
    await onSuccess(user);
  });
  requestAnimationFrame(() => form.loginUsername.focus());
}

/** First-run screen: creates the first admin using the bootstrap secret (MODAI_API_TOKEN). */
export function renderSetup({ onSuccess }) {
  const root = $("authScreen");
  const min = state.minPasswordLength;
  mount(root, frame(html`
    <div class="auth-card-head">
      <span class="badge tone-info">Primer inicio</span>
      <h1>Crea la cuenta de administración</h1>
      <p>Este servidor aún no tiene usuarios. Para demostrar que lo controlas, introduce el token de instalación (<code>MODAI_API_TOKEN</code> del archivo <code>deploy/.env</code> o de las variables del servidor).</p>
    </div>
    <form id="setupForm" class="stack" novalidate>
      ${passwordField({ id: "setupToken", label: "Token de instalación", autocomplete: "off", hint: "Solo se usa para esta comprobación; no se guarda en el navegador." })}
      <div class="field-row">
        <div class="field"><label for="setupUsername">Usuario</label><input id="setupUsername" autocomplete="username" autocapitalize="off" spellcheck="false" required minlength="3" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}" value="admin"><p class="hint">Letras, números, punto, guion o guion bajo.</p></div>
        <div class="field"><label for="setupDisplay">Nombre visible</label><input id="setupDisplay" autocomplete="name" maxlength="200" placeholder="Ej.: Equipo de plataforma"></div>
      </div>
      ${passwordField({ id: "setupPassword", label: "Contraseña", autocomplete: "new-password", minlength: min, hint: `Mínimo ${min} caracteres. Una frase larga es más segura que una palabra compleja.` })}
      ${strengthMeter("setupStrength")}
      ${passwordField({ id: "setupConfirm", label: "Repite la contraseña", autocomplete: "new-password", minlength: min })}
      <div class="form-error" role="alert" hidden></div>
      <button class="btn primary block large" type="submit">Crear administrador y entrar</button>
    </form>
  `));
  bindTheme(root);
  const form = root.querySelector("#setupForm");
  bindStrength(form.setupPassword, root.querySelector("#setupStrength"));
  bindForm(form, async () => {
    if (form.setupPassword.value !== form.setupConfirm.value) throw new Error("Las contraseñas no coinciden.");
    const { user } = await post("/auth/setup", {
      bootstrapToken: form.setupToken.value.trim(),
      username: form.setupUsername.value.trim(),
      displayName: form.setupDisplay.value.trim() || undefined,
      password: form.setupPassword.value,
    });
    await onSuccess(user, true);
  });
  requestAnimationFrame(() => form.setupToken.focus());
}
