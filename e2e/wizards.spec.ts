import { expect, type Page, test } from "@playwright/test";
import { writeZip } from "../packages/core/src/packages/zip.ts";
import { UI } from "../playwright.config.ts";

const auth = { authorization: `Bearer ${UI.token}` };

async function login(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Usuario").fill(UI.username);
  await page.getByLabel("Contraseña", { exact: true }).fill(UI.password);
  await page.getByRole("button", { name: /iniciar sesión|entrar/i }).click();
  await expect(page).toHaveURL(/#\/dashboard/);
}

test.describe.configure({ mode: "serial" });

test("crea un usuario paso a paso eligiendo organización, proyectos y namespaces por nombre", async ({
  page,
  request,
}) => {
  const org = (
    await (await request.post("/api/v1/organizations", { headers: auth, data: { name: "UI Logística" } })).json()
  ).organization;
  const other = (
    await (await request.post("/api/v1/organizations", { headers: auth, data: { name: "UI Otra" } })).json()
  ).organization;
  await request.post("/api/v1/projects", {
    headers: auth,
    data: { id: "ui-rutas", name: "Rutas", organizationId: org.id },
  });
  await request.post("/api/v1/projects", {
    headers: auth,
    data: { id: "ui-ajeno", name: "Ajeno", organizationId: other.id },
  });
  await request.post("/api/v1/namespaces", { headers: auth, data: { name: "@ui-logistica", organizationId: org.id } });

  await login(page);
  await page.goto("/admin#/users");
  await page.getByRole("button", { name: "Nuevo usuario" }).click();
  const dialog = page.getByRole("dialog");
  const next = () => dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Usuario", { exact: true }).fill("ui.logistica");
  await dialog.getByRole("button", { name: "Generar contraseña segura" }).click();
  await next();
  await dialog.getByRole("radio", { name: /Publicación/ }).check();
  await next();
  await dialog.getByRole("checkbox", { name: "UI Logística" }).check();
  await next();
  await expect(dialog.getByRole("checkbox", { name: /Rutas/ })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /Ajeno/ })).toBeHidden();
  await dialog.getByRole("checkbox", { name: /Rutas/ }).check();
  await next();
  await dialog.getByRole("checkbox", { name: "@ui-logistica" }).check();
  await next();
  await expect(dialog.locator("[data-review]")).toContainText("UI Logística");
  await expect(dialog.locator("[data-review]")).toContainText("Rutas");
  await expect(dialog.locator("[data-review]")).toContainText("@ui-logistica");
  await dialog.getByRole("button", { name: "Crear usuario" }).click();
  await expect(dialog.getByRole("heading", { name: "Usuario creado" })).toBeVisible();
  const users = (await (await request.get("/api/v1/admin/users", { headers: auth })).json()).users;
  const created = users.find((u: { username: string }) => u.username === "ui.logistica");
  expect(created).toMatchObject({
    role: "publisher",
    organizationIds: [org.id],
    projectIds: ["ui-rutas"],
    packageScopes: ["@ui-logistica"],
  });
});

test("importa un .skill con vista previa y lo publica", async ({ page }) => {
  await login(page);
  await page.goto("/admin#/packages");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /^Skill/ }).check();
  await dialog.getByRole("radio", { name: /Subir un archivo \.skill/ }).check();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("heading", { name: "Subir skill (.skill)" })).toBeVisible();
  const zip = writeZip([
    {
      path: "pr-review/SKILL.md",
      bytes: Buffer.from(
        "---\nname: pr-review\ndescription: Revisa pull requests con foco en regresiones y pruebas.\n---\n\n# PR review\n",
      ),
    },
  ]);
  await dialog
    .getByLabel("Archivo .skill o .zip")
    .setInputFiles({ name: "pr-review.skill", mimeType: "application/zip", buffer: zip });
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByLabel("Namespace").fill("@ui-skills");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.locator("#skillPreview")).toContainText("@ui-skills/pr-review");
  await expect(dialog.locator("#skillPreview")).toContainText("skills/pr-review/SKILL.md");
  await dialog.getByRole("button", { name: "Publicar skill" }).click();
  await expect(page.getByText("Publicado @ui-skills/pr-review@1.0.0")).toBeVisible();
});

test("sube un template desde un .zip y muestra cómo usarlo", async ({ page, request }) => {
  await request.post("/api/v1/namespaces", { headers: auth, data: { name: "@ui-plantillas" } });
  await login(page);
  await page.goto("/admin#/templates");
  await expect(page).toHaveURL(/#\/packages\?type=templates/);
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  const zip = writeZip([
    { path: "nest/package.json", bytes: Buffer.from('{ "name": "{{projectName}}" }\n') },
    { path: "nest/node_modules/x.js", bytes: Buffer.from("x") },
  ]);
  await dialog.locator("#tplZip").setInputFiles({ name: "nest.zip", mimeType: "application/zip", buffer: zip });
  await expect(dialog.locator("#tplSourceSummary")).toContainText("nest.zip");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.locator("#tplNamespaceInput").click();
  await dialog.getByRole("option", { name: "@ui-plantillas" }).click();
  await dialog.locator("#tplName").fill("nest-sdd");
  await dialog.getByLabel("Descripción").fill("NestJS con SDD para pruebas del panel");
  await dialog.locator("#tplTags").fill("nestjs, sdd");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.locator("#tplReview")).toContainText("@ui-plantillas/nest-sdd@1.0.0");
  await dialog.getByRole("button", { name: "Publicar template" }).click();
  await expect(dialog.getByRole("heading", { name: "@ui-plantillas/nest-sdd" })).toBeVisible();
  await expect(dialog.locator("#tplUseCommand")).toContainText("modai template use @ui-plantillas/nest-sdd@1.0.0");
  await expect(dialog.getByRole("link", { name: "Descargar .zip" })).toHaveAttribute("href", /packages\/download/);
  await dialog.getByRole("tab", { name: "Archivos" }).click();
  await expect(dialog.locator("#packageFiles")).toContainText("package.json");
  await expect(dialog.locator("#packageFiles")).not.toContainText("node_modules");
});

test("conectar un cliente guía por objetivo y crea una API key acotada al proyecto", async ({ page, request }) => {
  await request.post("/api/v1/projects", { headers: auth, data: { id: "ui-conectar", name: "Para conectar" } });
  await login(page);
  await page.goto("/admin#/connect");
  const form = page.locator("#connectWizard");
  const next = () => form.getByRole("button", { name: "Siguiente" }).click();
  await form.getByRole("radio", { name: /Ejecutar un worker/ }).check();
  await next();
  await next();
  await expect(form.locator(".form-error")).toBeVisible();
  await form.getByLabel(/Proyecto/).selectOption("ui-conectar");
  await next();
  await form.getByLabel(/Qué equipo o programa/).fill("Worker CI");
  await form.getByRole("button", { name: "Crear mi API key" }).click();
  await expect(form.locator("#credentialStep")).toContainText("Copia el token");
  await next();
  await expect(form.locator("#connectCommands")).toContainText("modai agent worker --project 'ui-conectar'");
  await next();
  await expect(form.locator("#verifyStep")).toContainText("Esperando");
  const keys = (await (await request.get("/api/v1/admin/api-keys", { headers: auth })).json()).keys;
  expect(keys.find((k: { label: string }) => k.label === "Worker CI")).toMatchObject({
    role: "worker",
    projectIds: ["ui-conectar"],
    ownerName: UI.username,
    inherit: false,
  });
});

test("una persona sin rol de administración crea y revoca sus propias API keys", async ({ page, request }) => {
  await request.post("/api/v1/admin/users", {
    headers: auth,
    data: { username: "ui.lectora", password: "ui-lectora-password", role: "reader" },
  });
  await page.goto("/admin");
  await page.getByLabel("Usuario").fill("ui.lectora");
  await page.getByLabel("Contraseña", { exact: true }).fill("ui-lectora-password");
  await page.getByRole("button", { name: /iniciar sesión|entrar/i }).click();
  await expect(page).toHaveURL(/#\/dashboard/);
  await expect(page.getByRole("link", { name: "Accesos" })).toHaveCount(0);
  await page.goto("/admin#/my-keys");
  await page.getByRole("button", { name: "Nueva API key" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Dónde se usará/).fill("Notebook");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.getByRole("radio")).toHaveCount(1);
  await expect(dialog.getByRole("radio", { name: /Lectura/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.locator("[data-review]")).toContainText("Los mismos que la cuenta");
  await dialog.getByRole("button", { name: "Crear API key" }).click();
  await expect(dialog.getByRole("heading", { name: "API key creada: Notebook" })).toBeVisible();
  await dialog.getByRole("button", { name: "He guardado el token" }).click();
  await expect(page.locator("#myKeys")).toContainText("Notebook");
  await page.getByRole("button", { name: "Revocar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revocar API key" }).click();
  await expect(page.locator("#myKeys")).not.toContainText("Notebook");
});

test("crea un template desde cero en el editor del panel y publica una versión editada", async ({ page, request }) => {
  await login(page);
  await page.goto("/admin#/packages?type=templates");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Crear aquí/ }).check();
  await expect(dialog.locator("#tplEditor")).toContainText("README.md");
  await dialog.getByRole("button", { name: "Nuevo archivo" }).click();
  await dialog.getByLabel("Ruta").fill("src/{{projectName}}.ts");
  await dialog.getByLabel("Contenido").fill("export const name = '{{projectName}}';\n");
  await dialog.getByRole("button", { name: "Guardar archivo" }).click();
  await dialog.getByRole("button", { name: "Eliminar AGENTS.md" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.locator("#tplNamespaceInput").click();
  await dialog.getByRole("option", { name: "@ui-plantillas" }).click();
  await dialog.locator("#tplName").fill("desde-cero");
  await dialog.getByLabel("Descripción").fill("Template creado en el panel");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByText(/Archivos \(/).click();
  await expect(dialog.locator("#tplReview")).toContainText("src/{{projectName}}.ts");
  await expect(dialog.locator("#tplReview")).not.toContainText("AGENTS.md");
  await dialog.getByRole("button", { name: "Publicar template" }).click();
  await expect(dialog.getByRole("heading", { name: "@ui-plantillas/desde-cero" })).toBeVisible();

  await dialog.getByRole("button", { name: "Editar y publicar nueva versión" }).click();
  await expect(dialog.locator("#tplEditor")).toContainText("src/{{projectName}}.ts");
  await dialog.getByRole("button", { name: "Editar README.md" }).click();
  await dialog.getByLabel("Contenido").fill("# {{projectName}}\n\nVersión 2\n");
  await dialog.getByRole("button", { name: "Guardar archivo" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await expect(dialog.locator("#tplVersion")).toHaveValue("1.0.1");
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("button", { name: "Publicar template" }).click();
  await expect(dialog.getByRole("heading", { name: "@ui-plantillas/desde-cero" })).toBeVisible();
  const latest = (
    await (
      await request.get("/api/v1/package?name=" + encodeURIComponent("@ui-plantillas/desde-cero"), { headers: auth })
    ).json()
  ).package;
  expect(latest.version).toBe("1.0.1");
  const files = (await (await request.get("/api/v1/artifacts/" + latest.artifactId, { headers: auth })).json()).files;
  const readme = files.find((f: { path: string }) => f.path === "README.md");
  expect(Buffer.from(readme.content, "base64").toString()).toContain("Versión 2");
});

test("una administración de organización ve Deprecar y Retirar solo en sus namespaces", async ({ page, request }) => {
  const org = (
    await (await request.post("/api/v1/organizations", { headers: auth, data: { name: "UI Pagos" } })).json()
  ).organization;
  await request.post("/api/v1/namespaces", { headers: auth, data: { name: "@ui-pagos", organizationId: org.id } });
  for (const name of ["@ui-pagos/cobro", "@ui-otro/cosa"]) {
    const content = "# Guía\n";
    await request.post("/api/v1/packages", {
      headers: auth,
      data: {
        manifest: {
          apiVersion: "modai.dev/v1",
          kind: "Package",
          metadata: {
            name,
            version: "1.0.0",
            description: `${name}: paquete de prueba del panel con descripción suficiente`,
          },
          spec: { contributes: { knowledge: [{ path: "knowledge/README.md", title: "Guía" }] } },
        },
        files: [
          {
            path: "knowledge/README.md",
            content: Buffer.from(content).toString("base64"),
            sha256: (await import("node:crypto")).createHash("sha256").update(content).digest("hex"),
          },
        ],
      },
    });
  }
  await request.post("/api/v1/admin/users", {
    headers: auth,
    data: { username: "ui.orgadmin", password: "ui-orgadmin-password", role: "org-admin", organizationIds: [org.id] },
  });
  await page.goto("/admin");
  await page.getByLabel("Usuario").fill("ui.orgadmin");
  await page.getByLabel("Contraseña", { exact: true }).fill("ui-orgadmin-password");
  await page.getByRole("button", { name: /iniciar sesión|entrar/i }).click();
  await expect(page).toHaveURL(/#\/dashboard/);
  const dialog = page.getByRole("dialog");
  await page.goto("/admin#/packages?name=@ui-pagos/cobro");
  await dialog.getByRole("tab", { name: /Versiones/ }).click();
  await expect(dialog.getByRole("button", { name: "Deprecar" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retirar" })).toBeVisible();
  await page.goto("/admin#/packages?name=@ui-otro/cosa");
  await dialog.getByRole("tab", { name: /Versiones/ }).click();
  await expect(dialog.getByRole("button", { name: "Deprecar" })).toHaveCount(0);
});

test("un modal solo se cierra con sus botones: ni el fondo ni Escape descartan lo escrito, y la página de atrás no se desplaza", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin#/packages");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  await dialog.getByRole("button", { name: "Cerrar" }).first().click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
});

test("el detalle de un template con features las lista y arma el comando al marcarlas", async ({ page, request }) => {
  await request.post("/api/v1/namespaces", { headers: auth, data: { name: "@ui-plantillas" } });
  const yaml =
    "features:\n  sdd:\n    description: Spec-Driven Development\n    path: features/sdd\n  lombok:\n    description: Lombok\n    path: features/lombok\n    default: true\n";
  const archive = writeZip([
    { path: "pom.xml", bytes: Buffer.from("<project/>") },
    { path: "modai.template.yaml", bytes: Buffer.from(yaml) },
    { path: "features/sdd/AGENTS.md", bytes: Buffer.from("sdd") },
    { path: "features/lombok/lombok.config", bytes: Buffer.from("x") },
  ]).toString("base64");
  const response = await request.post("/api/v1/packages/import-template", {
    headers: auth,
    data: { name: "@ui-plantillas/spring-flags", version: "1.0.0", description: "Spring con features", archive },
  });
  expect(response.status(), await response.text()).toBe(201);
  await login(page);
  await page.goto("/admin#/packages?type=templates");
  await page.locator('[data-name="@ui-plantillas/spring-flags"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Opciones (features)")).toBeVisible();
  await expect(dialog.locator("#tplUseCommand")).not.toContainText("--sdd");
  await dialog.locator('[data-feature="sdd"]').check();
  await expect(dialog.locator("#tplUseCommand")).toContainText("--sdd");
  await dialog.locator('[data-feature="lombok"]').uncheck();
  await expect(dialog.locator("#tplUseCommand")).toContainText("--no-lombok");
});

test("las opciones (flags) se crean en el editor: un template con --sdd y un componente con --metrics", async ({
  page,
  request,
}) => {
  await login(page);
  await page.goto("/admin#/packages?type=templates");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  const dialog = page.getByRole("dialog");
  const next = () => dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.getByRole("radio", { name: /Crear aquí/ }).check();
  await dialog.getByRole("button", { name: "Nuevo archivo" }).click();
  await dialog.getByLabel("Ruta").fill("features/sdd/specs/README.md");
  await dialog.getByLabel("Contenido").fill("# Specs de {{projectName}}\n");
  await dialog.getByRole("button", { name: "Guardar archivo" }).click();
  await next();
  await dialog.locator("#tplNamespaceInput").click();
  await dialog.getByRole("option", { name: "@ui-plantillas" }).click();
  await dialog.locator("#tplName").fill("con-flags");
  await dialog.getByLabel("Descripción").fill("Template con una opción creada en el panel");
  await next();
  await dialog.getByRole("button", { name: "Añadir opción" }).click();
  await dialog.getByLabel("Nombre de la opción").fill("sdd");
  await next();
  await expect(dialog.locator(".form-error")).toContainText("describe qué hace");
  await dialog.getByLabel("Qué hace").fill("Spec-Driven Development");
  await dialog.getByLabel(/Carpeta con sus archivos/).fill("features/nada");
  await next();
  await expect(dialog.locator(".form-error")).toContainText("no tiene archivos");
  await dialog.getByLabel(/Carpeta con sus archivos/).fill("features/sdd");
  await next();
  await expect(dialog.locator("#tplReview")).toContainText("--sdd");
  await dialog.getByRole("button", { name: "Publicar template" }).click();
  await expect(dialog.getByRole("heading", { name: "@ui-plantillas/con-flags" })).toBeVisible();
  await dialog.locator('[data-feature="sdd"]').check();
  await expect(dialog.locator("#tplUseCommand")).toContainText("--sdd");
  const info = await (
    await request.get("/api/v1/packages/template?name=" + encodeURIComponent("@ui-plantillas/con-flags"), {
      headers: auth,
    })
  ).json();
  expect(info.features.map((f: { name: string; path?: string }) => [f.name, f.path])).toEqual([
    ["sdd", "features/sdd"],
  ]);
  await dialog.getByRole("button", { name: "Cerrar" }).first().click();

  await page.goto("/admin#/packages?type=components");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  await next();
  await dialog.locator("#pkgNamespaceInput").click();
  await dialog.getByRole("option", { name: "@ui-plantillas" }).click();
  await dialog.getByLabel("Nombre", { exact: true }).fill("health-flags");
  await dialog.getByLabel("Descripción").fill("Componente con una opción de métricas creada en el panel.");
  await dialog.getByLabel("Nombre del componente").fill("health");
  await next();
  await dialog.getByRole("button", { name: "Nuevo archivo" }).click();
  await dialog.getByLabel("Ruta").fill("features/metrics/metrics.ts");
  await dialog.getByLabel("Contenido").fill("export const metrics = true;\n");
  await dialog.getByRole("button", { name: "Guardar archivo" }).click();
  await next();
  await expect(dialog.getByRole("button", { name: /Opciones/ })).toHaveAttribute("aria-current", "step");
  await dialog.getByRole("button", { name: "Añadir opción" }).click();
  await dialog.getByLabel("Nombre de la opción").fill("metrics");
  await dialog.getByLabel("Qué hace").fill("Expone métricas Prometheus");
  await dialog.getByLabel(/Carpeta con sus archivos/).fill("features/metrics");
  await next();
  await next();
  await expect(dialog.locator("#pkgManifest")).toHaveValue(
    /"metrics"[\s\S]*"component": "health"[\s\S]*"path": "features\/metrics"/,
  );
  await dialog.getByRole("button", { name: "Publicar" }).click();
  await expect(dialog.getByRole("heading", { name: "@ui-plantillas/health-flags" })).toBeVisible();
  await dialog.locator('[data-feature="metrics"]').check();
  await expect(dialog.locator("#installCommand")).toContainText("--metrics");
});

test("la administración gestiona categorías y el editor ofrece solo las registradas", async ({ page }) => {
  await login(page);
  await page.goto("/admin#/categories");
  await expect(page.locator("#catResults")).toContainText("backend");
  await page.getByRole("button", { name: "Nueva categoría" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#catName")).toBeFocused();
  await dialog.getByLabel("Nombre").fill("observabilidad");
  await dialog.getByLabel("Descripción").fill("Métricas, trazas y logs.");
  await dialog.getByRole("button", { name: "Crear categoría" }).click();
  await expect(page.locator("#catResults")).toContainText("observabilidad");

  await page.goto("/admin#/packages");
  await page.getByRole("button", { name: "Crear paquete" }).first().click();
  await dialog.getByRole("button", { name: "Siguiente" }).click();
  await dialog.locator("#pkgCategoryInput").click();
  await dialog.locator("#pkgCategoryInput").fill("observ");
  await expect(dialog.getByRole("option", { name: /observabilidad/ })).toContainText("Métricas, trazas y logs.");
  await dialog.getByRole("option", { name: /observabilidad/ }).click();
  await expect(dialog.locator("#pkgCategory")).toHaveValue("observabilidad");
  await dialog.locator("#pkgCategoryInput").fill("inventada");
  await dialog.getByLabel("Descripción").click();
  await expect(dialog.locator("#pkgCategory")).toHaveValue("");
  await dialog.getByRole("button", { name: "Cerrar" }).first().click();

  await page.goto("/admin#/categories");
  await page.getByRole("button", { name: "Eliminar observabilidad" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Eliminar categoría" }).click();
  await expect(page.locator("#catResults")).not.toContainText("observabilidad");
});

test("el conocimiento manual se guarda para todo el servidor o para un namespace", async ({ page, request }) => {
  await request.post("/api/v1/namespaces", { headers: auth, data: { name: "@ui-docs" } });
  await login(page);
  await page.goto("/admin#/knowledge");
  await page.getByRole("button", { name: "Nuevo documento" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#docTitle")).toBeVisible();
  await expect(dialog.locator("#docScope")).toHaveValue("Todo el servidor");
  await dialog.locator("#docScopeInput").click();
  await dialog.locator("#docScopeInput").fill("ui-docs");
  await dialog.getByRole("option", { name: /@ui-docs/ }).click();
  await expect(dialog.locator("#docGroupHint")).toContainText("@ui-docs/guias");
  await dialog.getByLabel("Título").fill("Guía de despliegue del equipo");
  await dialog.getByLabel("Contenido (Markdown)").fill("# Despliegue\n\nSiempre con verificación.");
  await dialog.getByRole("button", { name: "Guardar documento" }).click();
  await expect(page.locator("#docResults")).toContainText("@ui-docs/guias");
  const docs = (await (await request.get("/api/v1/knowledge/documents", { headers: auth })).json()).documents;
  expect(docs.find((doc: { title: string }) => doc.title === "Guía de despliegue del equipo").packageName).toBe(
    "@ui-docs/guias",
  );
});
