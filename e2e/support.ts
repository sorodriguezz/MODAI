import { type APIRequestContext, expect } from "@playwright/test";
import { UI } from "../playwright.config.ts";

const auth = { authorization: `Bearer ${UI.token}` };
const ORGANIZATION = "UI Pruebas";

export async function ensureNamespace(request: APIRequestContext, name: string): Promise<void> {
  const { organizations } = await (await request.get("/api/v1/organizations", { headers: auth })).json();
  let organization = organizations.find((item: { name: string }) => item.name === ORGANIZATION);
  if (!organization) {
    const created = await request.post("/api/v1/organizations", { headers: auth, data: { name: ORGANIZATION } });
    expect(created.status(), await created.text()).toBe(201);
    organization = (await created.json()).organization;
  }
  const response = await request.post("/api/v1/namespaces", {
    headers: auth,
    data: { name, organizationId: organization.id },
  });
  expect([201, 409], await response.text()).toContain(response.status());
}
