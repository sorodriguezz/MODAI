import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { UI } from "../playwright.config.ts";

test("el panel administra perfiles de proyecto, organización y equipo y muestra el resultado al lector", async ({
  page,
  request,
}) => {
  const headers = { authorization: `Bearer ${UI.token}` };
  const username = "lector.perfil";
  const password = "contraseña-de-perfil";
  const org = await request.post("/api/v1/organizations", { headers, data: { name: "Perfiles Panel" } });
  expect(org.status(), await org.text()).toBe(201);
  const organizationId = (await org.json()).organization.id;
  const namespace = await request.post("/api/v1/namespaces", { headers, data: { organizationId, name: "@perfil-ui" } });
  expect(namespace.status(), await namespace.text()).toBe(201);
  const project = await request.post("/api/v1/projects", {
    headers,
    data: { id: "perfil-ui", organizationId, name: "Portal de perfiles" },
  });
  expect(project.status(), await project.text()).toBe(201);
  const user = await request.post("/api/v1/admin/users", {
    headers,
    data: { username, password, role: "reader", organizationIds: [organizationId], projectIds: ["perfil-ui"] },
  });
  expect(user.status(), await user.text()).toBe(201);
  const packageName = "@perfil-ui/guia";
  const content = Buffer.from("# Guía de prueba\nConvenciones de integración del portal.");
  const published = await request.post("/api/v1/packages", {
    headers,
    data: {
      manifest: {
        apiVersion: "modai.dev/v1",
        kind: "Package",
        metadata: { name: packageName, version: "1.0.0", description: "Guía de prueba para perfiles en el panel" },
        spec: { contributes: { knowledge: [{ path: "guide.md", title: "Guía del portal" }] } },
      },
      files: [
        {
          path: "guide.md",
          content: content.toString("base64"),
          sha256: createHash("sha256").update(content).digest("hex"),
        },
      ],
    },
  });
  expect(published.status(), await published.text()).toBe(201);
  const login = async (account: string, secret: string) => {
    await page.goto("/admin");
    await page.getByLabel("Usuario").fill(account);
    await page.getByLabel("Contraseña", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/#\/dashboard/);
    await page.goto("/admin#/projects");
    await page
      .getByRole("row", { name: /Portal de perfiles/ })
      .getByRole("button", { name: "Perfil", exact: true })
      .click();
  };
  await login(UI.username, UI.password);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("El perfil no tiene asignaciones aplicables.")).toBeVisible();
  await dialog.getByRole("tab", { name: "Equipos" }).click();
  await dialog.getByLabel("Nombre del equipo").fill("QA Portal");
  await dialog.getByRole("button", { name: "Crear equipo" }).click();
  await dialog.getByLabel("Usuario de la organización").selectOption({ label: `${username} · ${username}` });
  await dialog.getByRole("button", { name: "Agregar integrante" }).click();
  await expect(dialog.getByRole("button", { name: `Quitar a ${username}` })).toBeVisible();
  await dialog.getByRole("tab", { name: "Asignaciones" }).click();
  const bind = async (label: string, slot: string) => {
    await dialog.getByLabel("Ámbito de asignación").selectOption({ label });
    await dialog.getByLabel("Identificador de la capacidad").fill(slot);
    await dialog.getByLabel("Paquete", { exact: true }).fill(packageName);
    await dialog.getByLabel("Versión o rango SemVer").fill("1.0.0");
    await dialog.getByRole("button", { name: "Guardar asignación" }).click();
    await expect(dialog.getByRole("row", { name: new RegExp(slot) })).toBeVisible();
  };
  await bind("Proyecto · Portal de perfiles", "regla-proyecto");
  await bind("Organización · Perfiles Panel", "regla-organizacion");
  await bind("Equipo · QA Portal", "regla-equipo");
  const teamBinding = dialog.getByRole("row", { name: /regla-equipo/ });
  await teamBinding.getByRole("button", { name: "Editar" }).click();
  await dialog.getByLabel("Asignación obligatoria").check();
  await dialog.getByRole("button", { name: "Guardar asignación" }).click();
  await expect(teamBinding).toContainText("Obligatoria");
  await dialog.getByRole("button", { name: "Cerrar" }).first().click();
  await page.locator("#userButton").click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page.getByLabel("Usuario")).toBeVisible();
  await login(username, password);
  await expect(dialog.getByRole("tab", { name: "Asignaciones" })).toHaveCount(0);
  await expect(dialog.getByText("regla-proyecto", { exact: true })).toBeVisible();
  await expect(dialog.getByText("regla-organizacion", { exact: true })).toBeVisible();
  await expect(dialog.getByText("regla-equipo", { exact: true })).toBeVisible();
  await expect(dialog.getByText(`${packageName}@1.0.0`, { exact: true })).toBeVisible();
});
