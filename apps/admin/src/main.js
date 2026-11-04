import { initRouter } from "./app/router.js";
import { boot, initSession } from "./app/session.js";
import { initShell } from "./app/shell.js";
import { initSidebar } from "./app/sidebar.js";
import { initUserMenu } from "./app/user-menu.js";
import { initCopyButtons } from "./shared/ui/code-block.js";
import { initDialog } from "./shared/ui/dialog.js";
import { initPasswordToggles } from "./shared/ui/password.js";

initPasswordToggles();
initCopyButtons();
initShell();
initDialog();
initSidebar();
initUserMenu();
initSession();
initRouter();
boot();
