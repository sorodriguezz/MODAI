import { expect, test } from "@playwright/test";
import { totp } from "../apps/server/src/modules/auth/totp.ts";
import { UI } from "../playwright.config.ts";

test("un usuario activa MFA, entra con un código de recuperación y lo desactiva", async ({ page, request }) => {
  const username = "mfa.browser";
  const password = "contraseña-mfa-de-prueba";
  const created = await request.post("/api/v1/admin/users", {
    headers: { authorization: `Bearer ${UI.token}` },
    data: { username, password, role: "reader" },
  });
  expect(created.status(), await created.text()).toBe(201);
  const login = async () => {
    await page.goto("/admin");
    await page.getByLabel("Usuario").fill(username);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
  };
  const account = () => page.getByRole("button", { name: /mfa.browser/ }).click();
  const security = async () => {
    await account();
    await page.getByRole("menuitem", { name: "Verificación en dos pasos" }).click();
  };
  await login();
  await expect(page).toHaveURL(/#\/dashboard/);
  await security();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Configurar verificación" }).click();
  await dialog.getByLabel("Contraseña actual", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Continuar" }).click();
  const secret = (await dialog.locator("#mfaSetupSecret").innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  await dialog.getByLabel("Código de la aplicación").fill(totp(key, Math.floor(Date.now() / 30_000)));
  await dialog.getByRole("button", { name: "Activar verificación" }).click();
  await expect(dialog.getByRole("heading", { name: "Guarda tus códigos de recuperación" })).toBeVisible();
  const codes = (await dialog.locator("#mfaRecoveryCodes").innerText()).trim().split("\n");
  expect(codes).toHaveLength(10);
  await dialog.getByRole("button", { name: "He guardado los códigos" }).click();
  await account();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page.getByLabel("Usuario")).toBeVisible();
  await login();
  const secondFactor = page.getByLabel("Código de verificación o recuperación");
  await expect(secondFactor).toBeVisible();
  await expect(page.getByLabel("Usuario")).toBeHidden();
  await secondFactor.fill("incorrecto");
  await page.getByRole("button", { name: "Verificar y entrar" }).click();
  await expect(page.getByRole("alert")).toContainText("El código es incorrecto");
  await secondFactor.fill(codes[0]);
  await page.getByRole("button", { name: "Verificar y entrar" }).click();
  await expect(page).toHaveURL(/#\/dashboard/);
  await security();
  await expect(dialog.getByText("Códigos de recuperación disponibles: 9.")).toBeVisible();
  await dialog.getByRole("button", { name: "Desactivar verificación" }).click();
  await dialog.getByLabel("Contraseña actual", { exact: true }).fill(password);
  await dialog.getByLabel("Código de verificación o recuperación").fill(codes[1]);
  await dialog.getByRole("button", { name: "Desactivar verificación" }).click();
  await expect(dialog).toBeHidden();
  await security();
  await expect(dialog.getByRole("button", { name: "Configurar verificación" })).toBeVisible();
});
