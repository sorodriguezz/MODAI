import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const { synchronize } = await import("../packages/cli/src/cli/installer.js");
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
  const result = await synchronize(api, project, manifest, { schemaVersion: 1, generatedAt: new Date(0).toISOString(), packages: [] });
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
