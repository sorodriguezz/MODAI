import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApp } from "../apps/server/src/http/app.js";

const root = mkdtempSync(join(tmpdir(), "modai-hierarchy-"));
const bootstrap = "hierarchy-bootstrap-secret";
const app = await createApp({ databasePath: join(root, "db.sqlite"), artifactDirectory: join(root, "artifacts"), apiToken: bootstrap, logger: false, adminDirectory: false, initialAdmin: false });
after(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const admin = as(bootstrap);
async function call(headers: Record<string, string>, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  const response = await app.inject({ method, url: "/api/v1" + url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: response.statusCode, body: response.body ? response.json() : null };
}
async function key(headers: Record<string, string>, label: string, role: string, grants: Record<string, string[]> = {}) {
  const created = await call(headers, "POST", "/admin/api-keys", { label, role, ...grants });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.key as { id: string; token: string };
}
const manifest = (name: string) => ({ manifest: { apiVersion: "modai.dev/v1", kind: "Package", metadata: { name, version: "1.0.0", description: "Paquete de prueba de jerarquía" }, spec: { category: "test" } }, files: [] });

let orgA = "", orgB = "", orgAdmin: Record<string, string> = {};

test("la administración global crea organizaciones, namespaces y proyectos por nombre", async () => {
  orgA = (await call(admin, "POST", "/organizations", { name: "Acme Pagos", description: "Cobros con tarjeta" })).body.organization.id;
  orgB = (await call(admin, "POST", "/organizations", { name: "Acme Facturas" })).body.organization.id;
  assert.equal((await call(admin, "POST", "/organizations", { name: "acme pagos" })).status, 409);
  assert.equal((await call(admin, "POST", "/namespaces", { name: "@pagos", organizationId: orgA, visibility: "restricted" })).status, 201);
  assert.equal((await call(admin, "POST", "/namespaces", { name: "@facturas", organizationId: orgB })).status, 201);
  assert.equal((await call(admin, "POST", "/namespaces", { name: "Sin Arroba" })).status, 400);
  assert.equal((await call(admin, "POST", "/projects", { id: "pa", name: "Portal pagos", organizationId: orgA })).status, 201);
  assert.equal((await call(admin, "POST", "/projects", { id: "pb", name: "Emisión", organizationId: orgB })).status, 201);
  const organizations = (await call(admin, "GET", "/organizations")).body.organizations;
  assert.deepEqual(organizations.map((o: { name: string; projects: number; namespaces: number }) => [o.name, o.projects, o.namespaces]), [["Acme Facturas", 1, 1], ["Acme Pagos", 1, 1]]);
  const projects = (await call(admin, "GET", "/projects")).body.projects;
  assert.equal(projects.find((p: { id: string }) => p.id === "pa").organizationName, "Acme Pagos");
});

test("una administración de organización solo ve y gestiona lo suyo", async () => {
  orgAdmin = as((await key(admin, "jefa pagos", "org-admin", { organizationIds: [orgA] })).token);
  const permissions = (await call(orgAdmin, "GET", "/session")).body.permissions;
  assert.equal(permissions.manage.users, true);
  assert.equal(permissions.manage.audit, false);
  assert.equal(permissions.manage.createOrganizations, false);
  assert.deepEqual(permissions.assignableRoles, ["reader", "publisher", "worker", "org-admin"]);
  assert.deepEqual(permissions.organizations.map((o: { name: string; manage: boolean }) => [o.name, o.manage]), [["Acme Pagos", true]]);
  assert.deepEqual(permissions.publish, { all: false, namespaces: ["@pagos"] });

  assert.equal((await call(orgAdmin, "POST", "/organizations", { name: "Otra" })).status, 403);
  assert.equal((await call(orgAdmin, "GET", "/admin/audit")).status, 403);
  assert.deepEqual((await call(orgAdmin, "GET", "/organizations")).body.organizations.map((o: { name: string }) => o.name), ["Acme Pagos"]);
  assert.deepEqual((await call(orgAdmin, "GET", "/projects")).body.projects.map((p: { id: string }) => p.id), ["pa"]);
  assert.equal((await call(orgAdmin, "PATCH", "/projects/pa", { name: "Portal de pagos" })).body.project.name, "Portal de pagos");
  assert.equal((await call(orgAdmin, "PATCH", "/projects/pa", { organizationId: orgB })).status, 403);
  assert.equal((await call(orgAdmin, "PATCH", "/organizations/" + orgA, { description: "Cobros y reembolsos" })).body.organization.description, "Cobros y reembolsos");
  assert.equal((await call(orgAdmin, "PATCH", "/organizations/" + orgB, { description: "x" })).status, 404);

  assert.equal((await call(orgAdmin, "POST", "/namespaces", { name: "@pagos-front", organizationId: orgA })).status, 201);
  assert.equal((await call(orgAdmin, "POST", "/namespaces", { name: "@ajeno", organizationId: orgB })).status, 403);
  assert.equal((await call(orgAdmin, "POST", "/namespaces", { name: "@huerfano" })).status, 400);
  assert.equal((await call(orgAdmin, "PATCH", "/namespaces/" + encodeURIComponent("@facturas"), { description: "x" })).status, 403);
  assert.equal((await call(orgAdmin, "POST", "/projects", { id: "pc", name: "Sin organización" })).status, 400);
  assert.equal((await call(orgAdmin, "POST", "/projects", { id: "pc", name: "Pagos móvil", organizationId: orgA })).status, 201);
});

test("los permisos que reparte una administración de organización siguen la jerarquía", async () => {
  let n = 0;
  const grant = (grants: Record<string, string[]>, role = "reader") => call(orgAdmin, "POST", "/admin/users", { username: `dev.${++n}`, password: "contraseña-segura-0", role, ...grants });
  assert.equal((await grant({ organizationIds: [orgA], projectIds: ["pa"], packageScopes: ["@pagos"] })).status, 201);
  assert.equal((await grant({ organizationIds: [orgA], projectIds: ["pb"] })).body.error.code, "PROJECT_OUTSIDE_ORGANIZATION");
  assert.equal((await grant({ organizationIds: [orgA], packageScopes: ["@facturas"] })).body.error.code, "NAMESPACE_OUTSIDE_ORGANIZATION");
  assert.equal((await grant({ organizationIds: [orgA], packageScopes: ["*"] })).status, 403);
  assert.equal((await grant({ organizationIds: [orgB] })).status, 403);
  assert.equal((await grant({})).body.error.code, "ORGANIZATION_REQUIRED");
  assert.equal((await grant({ organizationIds: [orgA] }, "admin")).status, 403);

  const created = await call(orgAdmin, "POST", "/admin/users", { username: "ana.pagos", password: "contraseña-segura-1", role: "publisher", organizationIds: [orgA], projectIds: ["pa"], packageScopes: ["@pagos"] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const other = await call(admin, "POST", "/admin/users", { username: "beto.facturas", password: "contraseña-segura-2", role: "reader", organizationIds: [orgB] });

  // API keys are created for a user and never exceed that user.
  const forAna = (body: Record<string, unknown>) => call(orgAdmin, "POST", "/admin/api-keys", { label: "ana ci", role: "reader", ownerId: created.body.user.id, ...body });
  assert.equal((await forAna({ projectIds: ["pc"] })).body.error.code, "KEY_EXCEEDS_OWNER");
  assert.equal((await forAna({ role: "org-admin" })).body.error.code, "KEY_EXCEEDS_OWNER");
  assert.equal((await forAna({ projectIds: ["pa"], organizationIds: [orgA] })).status, 201);
  assert.equal((await call(orgAdmin, "POST", "/admin/api-keys", { label: "x", role: "reader", ownerId: other.body.user.id })).status, 404);
  assert.equal((await call(orgAdmin, "POST", "/admin/api-keys", { label: "x", role: "reader", ownerId: null })).body.error.code, "OWNER_REQUIRED");

  const outsider = await key(admin, "facturas ci", "worker", { organizationIds: [orgB], projectIds: ["pb"] });
  const visible = (await call(orgAdmin, "GET", "/admin/api-keys")).body.keys.map((k: { label: string }) => k.label);
  assert.ok(visible.includes("ana ci") && visible.includes("jefa pagos"));
  assert.ok(!visible.includes("facturas ci"));
  assert.equal((await call(orgAdmin, "DELETE", "/admin/api-keys/" + outsider.id)).status, 404);
  assert.equal((await call(orgAdmin, "PATCH", "/admin/api-keys/" + outsider.id, { organizationIds: [orgA] })).status, 404);

  assert.deepEqual((await call(orgAdmin, "GET", "/admin/users")).body.users.map((u: { username: string }) => u.username), ["ana.pagos", "dev.1"]);
  assert.equal((await call(orgAdmin, "PATCH", "/admin/users/" + other.body.user.id, { disabled: true })).status, 404);
  assert.equal((await call(orgAdmin, "PATCH", "/admin/users/" + created.body.user.id, { role: "admin" })).status, 403);
  assert.equal((await call(orgAdmin, "PATCH", "/admin/users/" + created.body.user.id, { disabled: true })).body.user.disabledAt !== undefined, true);
  assert.equal((await call(orgAdmin, "DELETE", "/admin/users/" + created.body.user.id)).status, 204);
  assert.ok((await call(admin, "GET", "/admin/api-keys")).body.keys.find((k: { label: string }) => k.label === "ana ci").revokedAt, "las keys del usuario eliminado quedan revocadas");
});

test("cada persona crea sus API keys y nunca superan sus permisos, ni siquiera después", async () => {
  const csrf = { "x-modai-csrf": "1" };
  const user = (await call(admin, "POST", "/admin/users", { username: "carla.pagos", password: "contraseña-segura-3", role: "publisher", organizationIds: [orgA], projectIds: ["pa"], packageScopes: ["@pagos"] })).body.user;
  const login = await app.inject({ method: "POST", url: "/api/v1/auth/login", headers: csrf, payload: { username: "carla.pagos", password: "contraseña-segura-3" } });
  const cookie = String(login.headers["set-cookie"]).match(/modai_session=[^;]+/)![0];
  const session = { cookie, ...csrf };

  assert.equal((await call(session, "POST", "/me/api-keys", { label: "notebook", role: "admin" })).body.error.code, "KEY_EXCEEDS_OWNER");
  assert.equal((await call(session, "POST", "/me/api-keys", { label: "notebook", role: "publisher", projectIds: ["pb"] })).body.error.code, "KEY_EXCEEDS_OWNER");
  const inherited = (await call(session, "POST", "/me/api-keys", { label: "notebook", role: "publisher" })).body.key;
  assert.equal(inherited.inherit, true, "sin accesos explícitos hereda los de su dueña");
  const narrow = (await call(session, "POST", "/me/api-keys", { label: "ci lectura", role: "reader", projectIds: ["pa"] })).body.key;
  const worker = (await call(session, "POST", "/me/api-keys", { label: "worker", role: "worker", inherit: true })).body.key;
  assert.equal(worker.role, "worker", "una cuenta que publica puede tener keys de worker");

  const asKey = as(inherited.token);
  const whoami = (await call(asKey, "GET", "/session")).body;
  assert.equal(whoami.label, "carla.pagos · notebook");
  assert.deepEqual(whoami.permissions.publish.namespaces, ["@pagos"]);
  assert.equal((await call(asKey, "POST", "/me/api-keys", { label: "otra", role: "reader" })).body.error.code, "SESSION_REQUIRED", "una key no fabrica otras keys");
  assert.deepEqual((await call(asKey, "GET", "/me/api-keys")).body.keys.map((k: { label: string }) => k.label).sort(), ["ci lectura", "notebook", "worker"]);
  // A project created through a key belongs to its owner.
  assert.equal((await call(asKey, "POST", "/projects", { id: "carla-propio", name: "Propio", organizationId: orgA })).status, 201);
  assert.ok((await call(session, "GET", "/projects")).body.projects.some((p: { id: string }) => p.id === "carla-propio"));

  // Narrowing the owner narrows the keys on the next request.
  await call(admin, "PATCH", "/admin/users/" + user.id, { projectIds: [], packageScopes: [] });
  assert.equal((await call(as(narrow.token), "GET", "/memories?projectId=pa")).status, 403);
  assert.deepEqual((await call(asKey, "GET", "/session")).body.permissions.publish.namespaces, []);
  await call(admin, "PATCH", "/admin/users/" + user.id, { role: "reader" });
  assert.equal((await call(as(worker.token), "GET", "/session")).status, 401, "el rol de la key ya no cabe en el de su dueña");
  assert.equal((await call(as(narrow.token), "GET", "/session")).status, 200);
  await call(admin, "PATCH", "/admin/users/" + user.id, { disabled: true });
  assert.equal((await call(as(narrow.token), "GET", "/session")).status, 401, "una cuenta desactivada apaga sus keys");

  assert.equal((await call(asKey, "DELETE", "/me/api-keys/" + narrow.id)).status, 401);
  await call(admin, "PATCH", "/admin/users/" + user.id, { disabled: false, role: "publisher" });
  assert.equal((await call(asKey, "DELETE", "/me/api-keys/" + narrow.id)).status, 204, "la dueña revoca las suyas también desde la CLI");
});

test("los namespaces restringidos solo se ven con acceso y publicar exige el namespace", async () => {
  assert.equal((await call(admin, "POST", "/packages", manifest("@pagos/cobros"))).status, 201);
  assert.equal((await call(admin, "POST", "/packages", manifest("@facturas/emision"))).status, 201);
  const stranger = as((await key(admin, "lector facturas", "reader", { organizationIds: [orgB] })).token);
  const insider = as((await key(admin, "lector pagos", "reader", { organizationIds: [orgA], packageScopes: ["@pagos"] })).token);
  const names = async (headers: Record<string, string>) => (await call(headers, "GET", "/packages")).body.packages.map((p: { name: string }) => p.name).sort();
  assert.deepEqual(await names(stranger), ["@facturas/emision"]);
  assert.deepEqual(await names(insider), ["@facturas/emision", "@pagos/cobros"]);
  assert.deepEqual(await names(orgAdmin), ["@facturas/emision", "@pagos/cobros"]);
  assert.equal((await call(stranger, "GET", "/package?name=" + encodeURIComponent("@pagos/cobros"))).status, 404);
  assert.equal((await call(stranger, "POST", "/resolve", { packages: [{ name: "@pagos/cobros", range: "*" }] })).status, 404);
  assert.equal((await call(stranger, "GET", "/packages/catalog")).body.total, 1);
  assert.equal((await call(stranger, "GET", "/packages/summary")).body.packages, 1);
  const artifact = (await call(admin, "GET", "/package?name=" + encodeURIComponent("@pagos/cobros"))).body.package.artifactId;
  assert.equal((await call(stranger, "GET", "/artifacts/" + artifact)).status, 404);
  assert.equal((await call(insider, "GET", "/artifacts/" + artifact)).status, 200);
  assert.deepEqual((await call(stranger, "GET", "/namespaces")).body.namespaces.map((n: { name: string }) => n.name), ["@facturas", "@pagos-front"], "@pagos-front es interno");

  const publisher = as((await key(admin, "pub facturas", "publisher", { organizationIds: [orgB], packageScopes: ["@facturas"] })).token);
  const denied = await call(publisher, "POST", "/packages", manifest("@pagos/intruso"));
  assert.equal(denied.status, 403);
  assert.match(denied.body.error.message, /@pagos/);
  assert.equal((await call(orgAdmin, "POST", "/packages", manifest("@pagos/propio"))).status, 201);
  assert.equal((await call(admin, "POST", "/packages", manifest("@nuevo/auto"))).status, 201);
  assert.ok((await call(admin, "GET", "/namespaces")).body.namespaces.some((n: { name: string; organizationId?: string }) => n.name === "@nuevo" && !n.organizationId));
});

test("la administración de una organización depreca y retira paquetes de sus namespaces, pero no los elimina", async () => {
  const deprecate = (headers: Record<string, string>, name: string) => call(headers, "POST", "/admin/packages/deprecate", { name, version: "1.0.0", message: "Usa la 2.x" });
  const yank = (headers: Record<string, string>, name: string) => call(headers, "POST", "/admin/packages/yank", { name, version: "1.0.0", reason: "Error grave" });
  assert.equal((await deprecate(orgAdmin, "@pagos/propio")).body.package.status, "deprecated");
  assert.equal((await yank(orgAdmin, "@pagos/propio")).body.package.status, "yanked");
  assert.equal((await deprecate(orgAdmin, "@facturas/emision")).status, 403, "namespace de otra organización");
  assert.equal((await yank(orgAdmin, "@nuevo/auto")).status, 403, "namespace sin organización");
  assert.equal((await call(orgAdmin, "DELETE", "/admin/packages", { name: "@pagos/propio", version: "1.0.0", confirmation: "@pagos/propio@1.0.0" })).status, 403);
  const reader = as((await key(admin, "lector pagos 2", "publisher", { organizationIds: [orgA], packageScopes: ["@pagos"] })).token);
  assert.equal((await deprecate(reader, "@pagos/cobros")).status, 403, "publicar no es administrar");
  const permissions = (await call(orgAdmin, "GET", "/session")).body.permissions;
  assert.deepEqual(permissions.packages, { all: false, namespaces: ["@pagos", "@pagos-front"] });
});

test("organizaciones y namespaces con contenido no se eliminan", async () => {
  assert.equal((await call(admin, "DELETE", "/organizations/" + orgB, { confirmation: "Acme Facturas" })).body.error.code, "ORGANIZATION_NOT_EMPTY");
  assert.equal((await call(admin, "DELETE", "/namespaces/" + encodeURIComponent("@facturas"))).body.error.code, "NAMESPACE_NOT_EMPTY");
  assert.equal((await call(admin, "DELETE", "/namespaces/" + encodeURIComponent("@pagos-front"))).status, 204);
  const empty = (await call(admin, "POST", "/organizations", { name: "Vacía" })).body.organization.id;
  assert.equal((await call(admin, "DELETE", "/organizations/" + empty, { confirmation: "otra" })).status, 400);
  assert.equal((await call(admin, "DELETE", "/organizations/" + empty, { confirmation: "Vacía" })).status, 204);
});
