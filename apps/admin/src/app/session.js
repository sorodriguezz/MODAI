import { renderLogin, renderSetup } from "../features/auth/auth-screens.js";
import { get, health, post } from "../shared/lib/api.js";
import { $, html, mount } from "../shared/lib/html.js";
import { icon } from "../shared/lib/icons.js";
import { closeDialog } from "../shared/ui/dialog.js";
import { toast, toastError } from "../shared/ui/toast.js";
import { byId, hashParams, isVisible, MOVED, navigate, parseHash } from "./router.js";
import { renderNav, renderServerStatus, renderUser, show } from "./shell.js";
import { state, store } from "./state.js";

function clearSession() {
  state.identity = null;
  state.user = null;
  state.permissions = null;
  store.invalidate();
}

function showBootError(error) {
  show("auth");
  mount(
    $("authScreen"),
    html`<div class="auth-layout single"><section class="auth-main"><div class="auth-card"><div class="empty-state error"><span class="empty-icon">${icon("alert", 26)}</span><h3>No se pudo contactar con el servidor</h3><p>${error.message}</p><button class="btn primary" id="retryBoot">${icon("refresh")}Reintentar</button></div></div></section></div>`,
  );
  $("retryBoot").addEventListener("click", () => boot());
}

export async function boot(notice) {
  show("boot");
  try {
    state.health = await health().catch(() => null);
    const status = await get("/auth/status");
    state.minPasswordLength = status.minPasswordLength || 10;
    if (status.setupRequired) return showSetup();
    if (!status.authenticated || status.identity?.kind !== "user") return showLogin(notice);
    await enterApp(status);
  } catch (error) {
    showBootError(error);
  }
}

function showLogin(notice) {
  show("auth");
  renderLogin({ notice, onSuccess: () => boot() });
}

function showSetup() {
  show("auth");
  renderSetup({
    onSuccess: async () => {
      await boot();
      toast("Cuenta de administración creada. Ya puedes invitar a tu equipo desde Usuarios.");
    },
  });
}

async function enterApp(status) {
  state.identity = status.identity;
  state.user = status.user;
  state.permissions = status.permissions;
  store.invalidate();
  renderUser();
  renderNav();
  state.health = await health().catch(() => state.health);
  renderServerStatus();
  show("app");
  const target = parseHash();
  await navigate(target && (isVisible(byId[target]) || MOVED[target]) ? target : "dashboard", {
    params: MOVED[target] ? Object.fromEntries(hashParams()) : undefined,
    replace: true,
  });
}

export async function logout() {
  try {
    await post("/auth/logout");
  } catch (error) {
    toastError(error);
  }
  clearSession();
  history.replaceState(null, "", "#/dashboard");
  showLogin("Cerraste sesión correctamente.");
}

export function initSession() {
  window.addEventListener("modai:unauthorized", () => {
    if ($("appShell").hidden) return;
    closeDialog();
    clearSession();
    showLogin("Tu sesión expiró o se cerró. Vuelve a iniciar sesión.");
  });
}
