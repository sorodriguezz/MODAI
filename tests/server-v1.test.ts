import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../apps/server/src/http/app.js";
import { HttpRegistry, createProjectFile, loadPackageSource, loadV1Project, saveProjectFile, syncWorkspace } from "@modai/core";

const root = mkdtempSync(join(tmpdir(), "modai-server-v1-"));
process.env.MODAI_CONFIG_DIR = join(root, "config");
const app = await createApp({ databasePath: join(root, "db.sqlite"), artifactDirectory: join(root, "artifacts"), logger: false, apiToken: "v1-secret" });
const auth = { authorization: "Bearer v1-secret" };
const examples = join(process.cwd(), "examples", "packages");
before(async () => { await app.listen({ host: "127.0.0.1", port: 0 }); });
after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });

test("el servidor central actúa como registry v1: valida contratos, resuelve capacidades y expone proveedores", async () => {
  for (const name of ["testing-regression", "testing-playwright", "patterns-frontend-architecture", "skill-design-patterns"]) {
    const response = await app.inject({ method: "POST", url: "/api/v1/packages", headers: auth, payload: loadPackageSource(join(examples, name)) });
    assert.equal(response.statusCode, 201, response.body);
  }
  const listed = await app.inject({ method: "GET", url: "/api/v1/packages?name=@testing/regression", headers: auth });
  assert.deepEqual(listed.json().packages.map((item: { name: string; type: string }) => [item.name, item.type]), [["@testing/regression", "testing"]]);

  const missing = await app.inject({ method: "POST", url: "/api/v1/resolve", headers: auth, payload: { packages: [{ name: "@testing/regression" }] } });
  assert.equal(missing.statusCode, 409);
  assert.equal(missing.json().error.code, "CAPABILITY_UNSATISFIED");
  const resolved = await app.inject({ method: "POST", url: "/api/v1/resolve", headers: auth, payload: { packages: [{ name: "@testing/regression" }, { name: "@testing/playwright" }] } });
  assert.equal(resolved.statusCode, 200, resolved.body);

  const providers = await app.inject({ method: "GET", url: "/api/v1/capabilities?capability=browser.automation", headers: auth });
  assert.deepEqual(providers.json().contracts.map((item: { packageName: string }) => item.packageName), ["@testing/playwright"]);

  const invalid = loadPackageSource(join(examples, "testing-playwright"));
  (invalid.manifest as { metadata: { version: string }; spec: { permissions: string[] } }).metadata.version = "1.0.1";
  (invalid.manifest as { spec: { permissions: string[] } }).spec.permissions = [];
  const rejected = await app.inject({ method: "POST", url: "/api/v1/packages", headers: auth, payload: invalid });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error.code, "PERMISSION_UNDECLARED");

  // The same server is consumed by the Core through HttpRegistry.
  const server = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const project = join(root, "project");
  mkdirSync(project);
  saveProjectFile(project, createProjectFile("p", { registries: [{ name: "central", url: server }], dependencies: { "@testing/regression": "^1.0.0", "@testing/playwright": "^1.0.0" } }));
  const report = await syncWorkspace(loadV1Project(project), { registries: [new HttpRegistry(server, "v1-secret")], grants: [], trust: { policy: "optional", trustedPublishers: [] } });
  assert.deepEqual(report.installed.map(item => item.name).sort(), ["@testing/playwright", "@testing/regression"]);
  assert.ok(existsSync(join(project, ".agents/skills/regression-testing/SKILL.md")));
});

test("modai migrate convierte un proyecto 0.5 sin reescribir archivos idénticos ni perder la memoria remota", async () => {
  const { migrateV1 } = await import("../packages/cli/src/v1/commands.js");
  const { ApiClient } = await import("@modai/sdk");
  const { readFileSync, writeFileSync } = await import("node:fs");
  const YAML = (await import("yaml")).default;
  const server = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  process.env.MODAI_API_TOKEN = "v1-secret";
  const api = new ApiClient(server, "v1-secret");
  await api.createProject({ id: "legacy-project", name: "legacy" });
  const project = join(root, "legacy");
  mkdirSync(project);
  const manifest = { schemaVersion: 1 as const, projectId: "legacy-project", server, packages: { "@skills/design-patterns": "^1.0.0" }, overrides: {} };
  // What a 0.5 client left on disk: the package files at their targets plus manifest.yaml and lock.yaml.
  const record = (await api.listPackages("@skills/design-patterns")).find(item => item.name === "@skills/design-patterns")!;
  const artifact = await api.artifact(record.artifactId);
  const legacyFiles = (record.manifest as { files: Array<{ source: string; target: string }> }).files;
  const lockedFiles = [];
  for (const rule of legacyFiles) {
    const file = artifact.files.find(item => item.path === rule.source)!;
    mkdirSync(dirname(join(project, rule.target)), { recursive: true });
    writeFileSync(join(project, rule.target), Buffer.from(file.content, "base64"));
    lockedFiles.push({ target: rule.target, sha256: file.sha256 });
  }
  const result = { lock: { schemaVersion: 1, generatedAt: new Date(0).toISOString(), packages: [{ name: record.name, version: record.version, artifactId: record.artifactId, files: lockedFiles }] } };
  mkdirSync(join(project, ".modai"), { recursive: true });
  writeFileSync(join(project, ".modai/manifest.yaml"), YAML.stringify(manifest));
  writeFileSync(join(project, ".modai/lock.yaml"), YAML.stringify(result.lock));
  const before = readFileSync(join(project, ".agents/skills/design-patterns/SKILL.md"), "utf8");
  const output: unknown[] = [];
  await migrateV1(project, {}, value => output.push(value));
  try {
    const migrated = loadV1Project(project);
    assert.equal(migrated.file.context.projectId, "legacy-project");
    assert.equal(migrated.file.context.memory, "remote");
    assert.equal(migrated.lock.packages["@skills/design-patterns"].version, "1.0.0");
    assert.equal(readFileSync(join(project, ".agents/skills/design-patterns/SKILL.md"), "utf8"), before);
    assert.ok(existsSync(join(project, ".modai/legacy-0.5/manifest.yaml")));
  } finally { delete process.env.MODAI_API_TOKEN; }
});

test("un proyecto vinculado informa lo que instala y el servidor lo muestra solo a quien tiene acceso", async () => {
  const { runSync } = await import("../packages/cli/src/v1/runtime.js");
  const { createProjectFile, saveProjectFile } = await import("@modai/core");
  const { ApiClient } = await import("@modai/sdk");
  const server = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const admin = new ApiClient(server, "v1-secret");
  await admin.createProject({ id: "usage-project", name: "Uso" });
  const project = join(root, "usage");
  mkdirSync(project);
  saveProjectFile(project, createProjectFile("usage", { registries: [{ name: "central", url: server }], adapters: [], dependencies: { "@skills/design-patterns": "^1.0.0" }, context: { memory: "remote", server, projectId: "usage-project" } }));
  process.env.MODAI_API_TOKEN = "v1-secret";
  try { await runSync(project); } finally { delete process.env.MODAI_API_TOKEN; }

  const usage = await app.inject({ method: "GET", url: "/api/v1/packages/usage?name=@skills/design-patterns", headers: { authorization: "Bearer v1-secret" } });
  const rows = usage.json().projects.map((item: { projectId: string; version: string; direct: boolean }) => [item.projectId, item.version, item.direct]);
  assert.deepEqual(rows.find((row: string[]) => row[0] === "usage-project"), ["usage-project", "1.0.0", true]);
  assert.ok(rows.some((row: string[]) => row[0] === "legacy-project"), "un proyecto migrado también informa al sincronizar");

  const key = (await app.inject({ method: "POST", url: "/api/v1/admin/api-keys", headers: { authorization: "Bearer v1-secret" }, payload: { label: "outsider", role: "reader" } })).json().key.token;
  const hidden = await app.inject({ method: "GET", url: "/api/v1/packages/usage?name=@skills/design-patterns", headers: { authorization: `Bearer ${key}` } });
  assert.deepEqual(hidden.json().projects, [], "sin acceso al proyecto no se ve su uso");
  const forbidden = await app.inject({ method: "PUT", url: "/api/v1/projects/usage-project/installations", headers: { authorization: `Bearer ${key}` }, payload: { packages: [] } });
  assert.equal(forbidden.statusCode, 403, "solo informa quien tiene acceso al proyecto");
  const invalid = await app.inject({ method: "PUT", url: "/api/v1/projects/usage-project/installations", headers: { authorization: "Bearer v1-secret" }, payload: { packages: [{ name: "../x", version: "1" }] } });
  assert.equal(invalid.statusCode, 400);

  const catalog = await app.inject({ method: "GET", url: "/api/v1/packages/catalog?type=skills&limit=2", headers: { authorization: "Bearer v1-secret" } });
  assert.equal(catalog.statusCode, 200);
  assert.ok(catalog.json().items.length <= 2);
  const { normalizeManifest } = await import("@modai/core");
  assert.ok(catalog.json().items.every((item: { manifest: unknown }) => normalizeManifest(item.manifest).spec.contributes.skills.length > 0), "type=skills filtra por contribución, no por nombre");
  assert.ok(catalog.json().total >= catalog.json().items.length);
});

test("los backups conservan qué proyecto usa qué y el resumen del panel no necesita el catálogo completo", async () => {
  const headers = { authorization: "Bearer v1-secret" };
  const summary = (await app.inject({ method: "GET", url: "/api/v1/packages/summary", headers })).json();
  assert.ok(summary.packages >= 4 && summary.versions >= summary.packages);
  assert.ok(summary.recent.length > 0 && summary.recent.length <= 6);
  assert.ok(summary.recent.every((item: { name: string; category: string }) => item.name && item.category));

  const snapshot = (await app.inject({ method: "GET", url: "/api/v1/admin/export", headers })).json();
  const exported = snapshot.installations.find((item: { projectId: string; packageName: string }) => item.projectId === "usage-project" && item.packageName === "@skills/design-patterns");
  assert.deepEqual([exported.version, exported.direct], ["1.0.0", true]);

  const restoredRoot = mkdtempSync(join(tmpdir(), "modai-restore-"));
  const restored = await createApp({ databasePath: join(restoredRoot, "db.sqlite"), artifactDirectory: join(restoredRoot, "artifacts"), logger: false, apiToken: "restore-secret" });
  try {
    const restoreHeaders = { authorization: "Bearer restore-secret" };
    // A newer report already on the target server must survive an older backup.
    await restored.inject({ method: "POST", url: "/api/v1/projects", headers: restoreHeaders, payload: { id: "usage-project", name: "Uso" } });
    const imported = await restored.inject({ method: "POST", url: "/api/v1/admin/import", headers: restoreHeaders, payload: { ...snapshot, installations: [...snapshot.installations, { ...exported, packageName: "@skills/newer", version: "1.0.0" }] } });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.ok(imported.json().installations >= 1);
    const usage = (await restored.inject({ method: "GET", url: "/api/v1/packages/usage?name=@skills/design-patterns", headers: restoreHeaders })).json();
    assert.ok(usage.projects.some((item: { projectId: string; version: string }) => item.projectId === "usage-project" && item.version === "1.0.0"), "el uso se restaura sin esperar al siguiente sync");

    await restored.inject({ method: "PUT", url: "/api/v1/projects/usage-project/installations", headers: restoreHeaders, payload: { packages: [{ name: "@skills/design-patterns", version: "2.0.0", direct: true }] } });
    await restored.inject({ method: "POST", url: "/api/v1/admin/import", headers: restoreHeaders, payload: snapshot });
    const after = (await restored.inject({ method: "GET", url: "/api/v1/packages/usage?name=@skills/design-patterns", headers: restoreHeaders })).json();
    assert.equal(after.projects.find((item: { projectId: string }) => item.projectId === "usage-project").version, "2.0.0", "un informe más reciente gana a un backup antiguo");

    const broken = await restored.inject({ method: "POST", url: "/api/v1/admin/import", headers: restoreHeaders, payload: { ...snapshot, installations: [{ ...exported, packageName: "../escape" }] } });
    assert.equal(broken.statusCode, 400, "un backup manipulado se rechaza antes de importar nada");
  } finally {
    await restored.close();
    rmSync(restoredRoot, { recursive: true, force: true });
  }
});

test("un proyecto se elimina con su memoria, ejecuciones e instalaciones, y sale de los accesos", async () => {
  const as = (token: string) => ({ authorization: `Bearer ${token}` });
  const key = async (label: string, role: string, projectIds: string[] = []) =>
    (await app.inject({ method: "POST", url: "/api/v1/admin/api-keys", headers: auth, payload: { label, role, projectIds } })).json().key.token as string;
  const owner = await key("owner", "publisher");
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/projects", headers: as(owner), payload: { id: "doomed", name: "Condenado" } })).statusCode, 201);
  const member = await key("member", "publisher", ["doomed"]);
  const reader = await key("reader", "reader", ["doomed"]);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/memories", headers: as(owner), payload: { projectId: "doomed", content: "Decisión que se borra con el proyecto", kind: "decision" } })).statusCode, 201);
  assert.equal((await app.inject({ method: "PUT", url: "/api/v1/projects/doomed/installations", headers: as(owner), payload: { packages: [{ name: "@skills/design-patterns", version: "1.0.0", direct: true }] } })).statusCode, 204);

  const listed = (token: string) => app.inject({ method: "GET", url: "/api/v1/projects", headers: as(token) }).then(response => response.json().projects as Array<{ id: string; canDelete: boolean }>);
  assert.equal((await listed(owner)).find(item => item.id === "doomed")?.canDelete, true);
  assert.equal((await listed(member)).find(item => item.id === "doomed")?.canDelete, false, "tener acceso no basta para eliminar");

  const remove = (token: string, confirmation = "doomed") => app.inject({ method: "DELETE", url: "/api/v1/projects/doomed", headers: as(token), payload: { confirmation } });
  assert.equal((await remove(member)).statusCode, 403);
  assert.equal((await remove(reader)).statusCode, 403);
  assert.equal((await remove(owner, "otro")).statusCode, 400, "exige confirmar con el identificador");
  const deleted = await remove(owner);
  assert.equal(deleted.statusCode, 200, deleted.body);
  assert.equal(deleted.json().memories, 1);

  assert.ok(!(await listed(owner)).some(item => item.id === "doomed"));
  const session = (await app.inject({ method: "GET", url: "/api/v1/session", headers: as(member) })).json();
  assert.deepEqual(session.projectIds, [], "el proyecto sale de los accesos de las API keys");
  const usage = (await app.inject({ method: "GET", url: "/api/v1/packages/usage?name=@skills/design-patterns", headers: auth })).json();
  assert.ok(!usage.projects.some((item: { projectId: string }) => item.projectId === "doomed"), "sin registro de instalaciones huérfano");
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/memories?projectId=doomed", headers: auth })).statusCode, 403, "el proyecto ya no existe");
  // Re-creating the id starts empty.
  await app.inject({ method: "POST", url: "/api/v1/projects", headers: auth, payload: { id: "doomed", name: "Nuevo" } });
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/v1/memories?projectId=doomed", headers: auth })).json().memories, []);
});
