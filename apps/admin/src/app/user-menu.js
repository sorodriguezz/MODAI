import { openChangePassword } from "../features/account/change-password.js";
import { $ } from "../shared/lib/html.js";
import { navigate } from "./router.js";
import { logout } from "./session.js";

const ACTIONS = {
  password: () => openChangePassword(),
  connect: () => navigate("connect"),
  keys: () => navigate("my-keys"),
  logout: () => logout(),
};

function moveFocus(items, index, delta) {
  items[(index + delta + items.length) % items.length].focus();
}

export function initUserMenu() {
  const userButton = $("userButton");
  const userMenu = $("userMenu");
  const setUserMenu = (open) => {
    userMenu.hidden = !open;
    userButton.setAttribute("aria-expanded", String(open));
    if (open) userMenu.querySelector("[role=menuitem]").focus();
  };
  userButton.addEventListener("click", () => setUserMenu(userMenu.hidden));
  document.addEventListener("click", (event) => {
    if (!userMenu.hidden && !event.target.closest(".user-menu")) setUserMenu(false);
  });
  userMenu.addEventListener("keydown", (event) => {
    const items = [...userMenu.querySelectorAll("[role=menuitem]")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      setUserMenu(false);
      userButton.focus();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(items, index, event.key === "ArrowDown" ? 1 : -1);
    }
    if (event.key === "Tab") setUserMenu(false);
  });
  userMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-menu]");
    if (!item) return;
    setUserMenu(false);
    ACTIONS[item.dataset.menu]?.();
  });
}
