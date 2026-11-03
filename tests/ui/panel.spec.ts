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

test("crea un componente en el editor: archivos, carpetas, validación y publicación", async ({ page }) => {
  await login(page);
  await page.goto("/admin#/packages");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Crear paquete" })).toBeVisible();

  // Invalid names are rejected by the browser's validation (patterns must compile with the v flag).
  await dialog.getByLabel("Nombre", { exact: true }).fill("Sin Scope");
  await dialog.getByRole("button", { name: "Publicar" }).click();
  await expect(dialog.locator(".form-error")).toBeVisible();

  await dialog.getByLabel("Nombre", { exact: true }).fill("@ui/users-module");
  await dialog.getByLabel("Descripción").fill("Módulo de usuarios para NestJS con controlador, servicio y DTOs.");
  await dialog.getByLabel("Nombre del componente").fill("users");
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

  await dialog.getByRole("button", { name: "Validar" }).click();
  await expect(dialog.locator("#validation")).toContainText("Calidad estructural");
  await dialog.getByRole("button", { name: "Publicar" }).click();

  // After publishing, the detail of the new package opens with content (not an empty dialog).
  await expect(dialog.getByRole("heading", { name: "@ui/users-module" })).toBeVisible();
  await expect(dialog.locator("#installCommand, .code-block").first()).toContainText("--allow project.source");
  await dialog.getByRole("tab", { name: "Archivos" }).click();
  await expect(dialog.locator("#packageFiles")).toContainText("component/helpers/hash.ts");
  await expect(dialog.locator("#packageFiles")).not.toContainText("component/tmp");
});

test("publica una nueva versión desde el detalle conservando manifiesto y archivos", async ({ page }) => {
  await login(page);
  await page.goto("/admin#/packages?name=@ui/users-module");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Editar y publicar nueva versión" }).click();
  await expect(dialog.getByLabel("Versión")).toHaveValue("0.1.1");
  await expect(dialog.getByLabel("Nombre", { exact: true })).toHaveAttribute("readonly", "");
  await expect(dialog.locator("#fileList")).toContainText("hash.ts");
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
  await expect(page.locator("#packageMeta")).toContainText("27 paquetes");
  await expect(page.locator(".package-card")).toHaveCount(24);
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(page.locator(".package-card")).toHaveCount(3);

  await page.getByLabel("Tipo").selectOption("components");
  await expect(page.locator(".package-card")).toHaveCount(1);
  await expect(page.locator(".package-card")).toContainText("@ui/users-module");
  await expect(page.getByText(/Página \d de/)).toHaveCount(0);

  await page.getByLabel("Tipo").selectOption("");
  await page.getByLabel("Buscar paquetes").fill("guide-07");
  await expect(page.locator(".package-card")).toHaveCount(1);
  await page.getByLabel("Buscar paquetes").fill("no-existe-nada");
  await expect(page.getByText("Sin resultados")).toBeVisible();
});

test("Resumen, Agentes, Ejecuciones y Conectar no descargan el catálogo completo", async ({ page, request }) => {
  const published = await request.post("/api/v1/packages", { headers: auth, data: {
    manifest: { schemaVersion: 1, name: "@ui/reviewer", version: "1.0.0", type: "agent", description: "Agente de revisión usado por las pruebas del panel",
      agent: { instructions: "Revisa el código con evidencia.", skills: [], capabilities: [], memory: { read: ["project"], write: false } } },
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

  await page.goto("/admin#/agents");
  await expect(page.locator(".card", { hasText: "@ui/reviewer" })).toBeVisible();
  await page.goto("/admin#/runs");
  await expect(page.locator("main")).toBeVisible();
  await page.goto("/admin#/connect");
  await expect(page.locator("select option", { hasText: "@ui/reviewer@1.0.0" })).toHaveCount(1);

  expect(fullCatalog).toEqual([]);
});
