import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { UI } from "../../playwright.config.ts";

const auth = { authorization: `Bearer ${UI.token}` };

function file(path: string, content: string) {
  return { path, content: Buffer.from(content).toString("base64"), sha256: createHash("sha256").update(content).digest("hex") };
}

async function publish(request: APIRequestContext, name: string, version: string, spec: Record<string, unknown> = {}, files = [file("knowledge/README.md", "# Guía\n")]) {
  const response = await request.post("/api/v1/packages", { headers: auth, data: {
    manifest: { apiVersion: "modai.dev/v1", kind: "Package", metadata: { name, version, description: `${name}: paquete de prueba del panel con descripción suficiente` }, spec: { contributes: { knowledge: [{ path: "knowledge/README.md", title: "Guía" }] }, ...spec } },
    files,
  } });
  expect(response.status(), await response.text()).toBe(201);
}

async function login(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Usuario").fill(UI.username);
  await page.getByLabel("Contraseña", { exact: true }).fill(UI.password);
  await page.getByRole("button", { name: /iniciar sesión|entrar/i }).click();
  await expect(page).toHaveURL(/#\/dashboard/);
}

test.describe.configure({ mode: "serial" });

test("crea un componente en el editor: archivos, carpetas, validación y publicación", async ({ page, request }) => {
  await request.post("/api/v1/namespaces", { headers: { authorization: `Bearer ${UI.token}` }, data: { name: "@ui" } });
  await login(page);
  await page.goto("/admin#/packages");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Crear paquete" })).toBeVisible();

  // Step by step: type → identity → files → options → dependencies → review.
  const next = () => dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("button", { name: /Tipo/ })).toHaveAttribute("aria-current", "step");
  await next();

  // Invalid names are rejected by the browser's validation (patterns must compile with the v flag) and block the step.
  await dialog.getByLabel("Nombre", { exact: true }).fill("Sin Scope");
  await next();
  await expect(dialog.locator(".form-error")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Identidad/ })).toHaveAttribute("aria-current", "step");

  await dialog.locator("#pkgNamespaceInput").fill("ui");
  await dialog.getByRole("option", { name: "@ui", exact: true }).click();
  await expect(dialog.locator("#pkgNamespace")).toHaveValue("@ui");
  await dialog.getByLabel("Nombre", { exact: true }).fill("users-module");
  await dialog.getByLabel("Descripción").fill("Módulo de usuarios para NestJS con controlador, servicio y DTOs.");
  await dialog.getByLabel("Nombre del componente").fill("users");
  await next();
  await expect(dialog.locator("#fileList")).toContainText("README.md");

  // A nested file, then rename and delete whole folders.
  await dialog.getByRole("button", { name: "Nuevo archivo" }).click();
  await dialog.getByLabel("Ruta").fill("component/utils/hash.ts");
  await dialog.getByLabel("Contenido").fill("export const hash = (value: string) => value;\n");
  await dialog.getByRole("button", { name: "Guardar archivo" }).click();
  await expect(dialog.locator(".folder-row", { hasText: "component/utils/" })).toBeVisible();
  await dialog.getByRole("button", { name: "Renombrar la carpeta component/utils" }).click();
  await dialog.getByLabel("Nuevo nombre de component/utils").fill("component/helpers");
  await dialog.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(dialog.locator(".folder-row", { hasText: "component/helpers/" })).toBeVisible();
  await expect(dialog.locator(".folder-row", { hasText: "component/utils/" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Nuevo archivo" }).click();
  await dialog.getByLabel("Ruta").fill("component/tmp/scratch.ts");
  await dialog.getByLabel("Contenido").fill("// borrar\n");
  await dialog.getByRole("button", { name: "Guardar archivo" }).click();
  await dialog.getByRole("button", { name: "Eliminar la carpeta component/tmp" }).click();
  await dialog.getByRole("button", { name: "Eliminar carpeta" }).click();
  await expect(dialog.locator(".folder-row", { hasText: "component/tmp/" })).toHaveCount(0);

  await next();
  // Options (flags) are optional: none here.
  await expect(dialog.getByRole("button", { name: /Opciones/ })).toHaveAttribute("aria-current", "step");
  await next();
  await dialog.getByRole("button", { name: "Añadir dependencia" }).click();
  await next();
  await expect(dialog.locator(".form-error")).toContainText("Elige un namespace y un paquete");
  await dialog.getByRole("button", { name: /Quitar/ }).click();
  await next();
  // Arriving at the review validates automatically, with the score broken down by dimension.
  await expect(dialog.locator("#validation")).toContainText("Calidad estructural");
  await expect(dialog.locator("#validation .quality-dimensions")).toContainText("Documentación");
  await dialog.getByRole("button", { name: "Publicar" }).click();

  // After publishing, the detail of the new package opens with content (not an empty dialog).
  await expect(dialog.getByRole("heading", { name: "@ui/users-module" })).toBeVisible();
  await expect(dialog.locator("#installCommand, .code-block").first()).toContainText("--allow project.source");
  await dialog.getByRole("tab", { name: "Archivos" }).click();
  await expect(dialog.locator("#packageFiles")).toContainText("component/helpers/hash.ts");
  await expect(dialog.locator("#packageFiles")).not.toContainText("component/tmp");
});

test("crea un perfil eligiendo namespace, paquete y versión, sin paso de archivos", async ({ page }) => {
  await login(page);
  await page.goto("/admin#/packages");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  const next = () => dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("radio", { name: /Perfil/ }).check();
  await expect(dialog.getByRole("button", { name: /Archivos/ })).toHaveCount(0);
  await next();
  await dialog.locator("#pkgNamespaceInput").fill("ui");
  await dialog.getByRole("option", { name: "@ui", exact: true }).click();
  await dialog.getByLabel("Nombre", { exact: true }).fill("my-profile");
  await dialog.getByLabel("Descripción").fill("Perfil que compone el módulo de usuarios.");
  await dialog.locator("#pkgCategoryInput").click();
  await dialog.getByRole("option", { name: /^profile/ }).click();
  await expect(dialog.locator("#pkgCategory")).toHaveValue("profile");
  await next();
  await expect(dialog.getByRole("button", { name: /Composición/ })).toHaveAttribute("aria-current", "step");
  await next();
  await expect(dialog.locator(".form-error")).toContainText("al menos uno");
  await dialog.getByRole("button", { name: "Añadir paquete" }).click();
  await dialog.locator("#depList").getByLabel("Namespace").selectOption("@ui");
  await dialog.locator("#depList").getByLabel("Paquete", { exact: true }).selectOption("@ui/users-module");
  await expect(dialog.locator("#dep0Version")).toHaveValue("0.1.0");
  await next();
  await expect(dialog.locator("#validation")).toContainText("Calidad estructural");
  await expect(dialog.locator("#pkgManifest")).toHaveValue(/"kind": "Profile"[\s\S]*"@ui\/users-module": "\^0\.1\.0"/);
  await dialog.getByRole("button", { name: "Publicar" }).click();
  await expect(dialog.getByRole("heading", { name: "@ui/my-profile" })).toBeVisible();
});

test("publica una nueva versión desde el detalle conservando manifiesto y archivos", async ({ page }) => {
  await login(page);
  await page.goto("/admin#/packages?name=@ui/users-module");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Editar y publicar nueva versión" }).click();
  await expect(dialog.getByLabel("Versión")).toHaveValue("0.1.1");
  await expect(dialog.getByLabel("Nombre", { exact: true })).toHaveAttribute("readonly", "");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.locator("#fileList")).toContainText("hash.ts");
  // The stepper jumps straight to the review once the previous steps are valid.
  await dialog.getByRole("button", { name: /Revisión/ }).click();
  await expect(dialog.locator("#validation")).toContainText("Calidad estructural");
  await dialog.getByRole("button", { name: "Publicar" }).click();
  await expect(dialog.getByText("Versión 0.1.1", { exact: false }).first()).toBeVisible();
  await dialog.getByRole("tab", { name: /Versiones/ }).click();
  await expect(dialog.getByRole("cell", { name: "0.1.0" })).toBeVisible();
});

test("muestra qué proyectos usan un paquete, con su versión", async ({ page, request }) => {
  const project = await request.post("/api/v1/projects", { headers: auth, data: { id: "ui-shop", name: "Tienda" } });
  expect(project.ok()).toBeTruthy();
  const reported = await request.put("/api/v1/projects/ui-shop/installations", { headers: auth, data: { packages: [{ name: "@ui/users-module", version: "0.1.0", direct: true }] } });
  expect(reported.status()).toBe(204);

  await login(page);
  await page.goto("/admin#/packages?name=@ui/users-module");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Proyectos" }).click();
  const row = dialog.getByRole("row", { name: /Tienda/ });
  await expect(row).toContainText("0.1.0");
  await expect(row).toContainText("desactualizado");
  await expect(row).toContainText("Directa");
});

test("el catálogo pagina en el servidor y filtra por tipo y texto", async ({ page, request }) => {
  for (let index = 0; index < 26; index++) await publish(request, `@ui/guide-${String(index).padStart(2, "0")}`, "1.0.0");
  await login(page);
  await page.goto("/admin#/packages");
  await expect(page.locator("#packageMeta")).toContainText("28 paquetes");
  await expect(page.locator(".package-card")).toHaveCount(24);
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(page.locator(".package-card")).toHaveCount(4);

  const types = page.getByRole("toolbar", { name: "Tipo de paquete" });
  await types.getByRole("button", { name: "Componentes" }).click();
  await expect(page.locator(".package-card")).toHaveCount(1);
  await expect(page.locator(".package-card")).toContainText("@ui/users-module");
  await expect(page.getByText(/Página \d de/)).toHaveCount(0);

  await types.getByRole("button", { name: "Todos" }).click();
  await page.getByLabel("Buscar paquetes").fill("guide-07");
  await expect(page.locator(".package-card")).toHaveCount(1);
  await page.getByLabel("Buscar paquetes").fill("no-existe-nada");
  await expect(page.getByText("Sin resultados")).toBeVisible();
});

test("Resumen, Agentes, Ejecuciones y Conectar no descargan el catálogo completo", async ({ page, request }) => {
  const published = await request.post("/api/v1/packages", { headers: auth, data: {
    manifest: { apiVersion: "modai.dev/v1", kind: "Package", metadata: { name: "@ui/reviewer", version: "1.0.0", description: "Agente de revisión usado por las pruebas del panel" },
      spec: { category: "agent", contributes: { agents: [{ name: "reviewer", instructions: "Revisa el código con evidencia.", skills: [], capabilities: [], memory: { read: ["project"], write: false } }] } } },
    files: [],
  } });
  expect(published.status(), await published.text()).toBe(201);

  const fullCatalog: string[] = [];
  page.on("request", (sent) => {
    const url = new URL(sent.url());
    // Only the paginated catalog, the summary, usage and a single package by name are allowed.
    if (url.pathname === "/api/v1/packages" && !url.searchParams.get("name")) fullCatalog.push(url.pathname + url.search);
  });
  await login(page);

  await expect(page.locator(".stat-card", { hasText: "Paquetes" })).toContainText("29");
  await expect(page.locator(".stat-card", { hasText: "Agentes" })).toContainText("1");
  await expect(page.locator("#recentPackages")).toContainText("@ui/reviewer");

  // Agentes is no longer a menu: old links land on the Agentes tab of Paquetes, and the agent opens from its detail.
  await page.goto("/admin#/agents");
  await expect(page).toHaveURL(/#\/packages\?type=agents/);
  await expect(page.getByRole("toolbar", { name: "Tipo de paquete" }).getByRole("button", { name: "Agentes" })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".card", { hasText: "@ui/reviewer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Usar reviewer" }).click();
  await expect(page.getByRole("dialog").locator("#activateCommand")).toContainText("modai agent activate @ui/reviewer@1.0.0");
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).first().click();
  await page.goto("/admin#/runs");
  await expect(page.locator("main")).toBeVisible();
  await page.goto("/admin#/connect");
  await expect(page.locator("select option", { hasText: "@ui/reviewer@1.0.0" })).toHaveCount(1);

  expect(fullCatalog).toEqual([]);
});

test("elimina un proyecto tras confirmar escribiendo su identificador", async ({ page, request }) => {
  expect((await request.post("/api/v1/projects", { headers: auth, data: { id: "ui-borrar", name: "Para borrar" } })).ok()).toBeTruthy();
  await login(page);
  await page.goto("/admin#/projects");
  await page.getByRole("button", { name: "Eliminar el proyecto Para borrar (ui-borrar)" }).click();
  const dialog = page.getByRole("dialog");
  const confirmButton = dialog.getByRole("button", { name: "Eliminar proyecto" });
  await expect(confirmButton).toBeDisabled();
  await dialog.getByLabel(/Escribe ui-borrar/).fill("ui-borrar");
  await confirmButton.click();
  await expect(page.getByText(/Proyecto «Para borrar» eliminado/)).toBeVisible();
  await expect(page.locator("#projectResults")).not.toContainText("ui-borrar");
  await expect(page.locator("#projectResults")).toContainText("ui-shop");
});

test("la versión de un paquete nuevo no puede repetir ni ser menor que la última publicada", async ({ page, request }) => {
  await request.post("/api/v1/namespaces", { headers: auth, data: { name: "@ui" } });
  await publish(request, "@ui/ver-check", "1.2.0");
  await login(page);
  await page.goto("/admin#/packages");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.locator("#pkgNamespaceInput").click();
  await dialog.getByRole("option", { name: "@ui", exact: true }).click();
  await dialog.getByLabel("Nombre", { exact: true }).fill("ver-check");
  await expect(dialog.locator("#pkgVersionHint")).toContainText("Última publicada: 1.2.0");
  await expect(dialog.locator("#pkgVersion")).toHaveValue("1.2.1");
  await dialog.locator("#pkgVersion").fill("1.0.0");
  await expect(dialog.locator("#pkgVersionHint")).toContainText("mayor que la última publicada (1.2.0)");
  await dialog.locator("#pkgVersion").fill("1.2.0");
  await expect(dialog.locator("#pkgVersionHint")).toContainText("ya existe");
  await dialog.getByLabel("Descripción").fill("Paquete de prueba de versiones del panel con descripción suficiente.");
  await dialog.getByLabel("Nombre del componente").fill("users");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.locator(".form-error")).toContainText("ya existe");
  await dialog.locator("#pkgVersion").fill("1.3.0");
  await expect(dialog.locator("#pkgVersionHint")).not.toHaveClass(/invalid/);
});

test("el detalle de un paquete con features arma el comando de instalación respetando requires y conflicts", async ({ page, request }) => {
  await request.post("/api/v1/namespaces", { headers: auth, data: { name: "@ui" } });
  await publish(request, "@ui/health-flags", "1.0.0", {
    permissions: ["project.source"],
    contributes: { knowledge: [{ path: "knowledge/README.md", title: "Guía" }], components: [{ name: "health", path: "component", target: "src/modules/{component}" }] },
    features: {
      metrics: { description: "Métricas", default: true, overlays: [{ component: "health", path: "features/metrics" }] },
      tls: { description: "TLS", requires: ["metrics"], overlays: [{ component: "health", path: "features/tls" }] },
      legacy: { description: "Legacy", conflicts: ["tls"], overlays: [{ component: "health", path: "features/legacy" }] },
    },
  }, [file("knowledge/README.md", "# Guía\n"), file("component/health.ts", "x"), file("features/metrics/m.ts", "m"), file("features/tls/t.ts", "t"), file("features/legacy/l.ts", "l")]);
  await login(page);
  await page.goto("/admin#/packages?name=@ui/health-flags");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Opciones (features)")).toBeVisible();
  const command = dialog.locator("#installCommand");
  await expect(command).toHaveText("modai add @ui/health-flags@1.0.0 --allow project.source");
  // Unchecking a default writes --no-x; checking a feature that requires it checks it back.
  await dialog.locator('[data-feature="metrics"]').uncheck();
  await expect(command).toContainText("--no-metrics");
  await dialog.locator('[data-feature="tls"]').check();
  await expect(dialog.locator('[data-feature="metrics"]')).toBeChecked();
  await expect(command).toHaveText("modai add @ui/health-flags@1.0.0 --tls --allow project.source");
  // A conflicting feature unchecks the other one.
  await dialog.locator('[data-feature="legacy"]').check();
  await expect(dialog.locator('[data-feature="tls"]')).not.toBeChecked();
  await expect(command).toHaveText("modai add @ui/health-flags@1.0.0 --legacy --allow project.source");
  // Unchecking a feature unchecks what needs it, so the command is always one the CLI accepts.
  await dialog.locator('[data-feature="tls"]').check();
  await expect(dialog.locator('[data-feature="legacy"]')).not.toBeChecked();
  await dialog.locator('[data-feature="metrics"]').uncheck();
  await expect(dialog.locator('[data-feature="tls"]')).not.toBeChecked();
  await expect(command).toHaveText("modai add @ui/health-flags@1.0.0 --no-metrics --allow project.source");
});
