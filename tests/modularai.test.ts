import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../src/http/app.js";
import { ApiClient } from "../src/cli/api.js";
import { synchronize } from "../src/cli/installer.js";
import type { ProjectLock, ProjectManifest } from "../src/cli/config.js";
import type { PackageManifest, PublishPackageInput } from "../src/core/types.js";
import { signaturePayload } from "../src/core/security.js";
import { auditHarness, createHarness } from "../src/cli/harness-tools.js";

const root = mkdtempSync(join(tmpdir(), "modai-test-"));
const app = await createApp({
  databasePath: join(root, "modularai.db"),
  artifactDirectory: join(root, "artifacts"),
  logger: false,
});

before(async () => {
  await app.listen({ host: "127.0.0.1", port: 0 });
});

after(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

function payload(manifest: PackageManifest, sources: Record<string, string> = {}): PublishPackageInput {
  return {
    manifest,
    files: Object.entries(sources).map(([path, value]) => {
      const content = Buffer.from(value);
      return { path, content: content.toString("base64"), sha256: createHash("sha256").update(content).digest("hex") };
    }),
  };
}

function manifest(name: string, version: string, dependencies?: Record<string, string>): PackageManifest {
  return { schemaVersion: 1, name, version, type: "tool", description: `${name} ${version}`, dependencies };
}

test("publica, resuelve con backtracking y ordena dependencias primero", async () => {
  for (const item of [
    manifest("@test/core", "1.0.0"),
    manifest("@test/core", "2.0.0"),
    manifest("@test/a", "1.0.0", { "@test/core": "*" }),
    manifest("@test/b", "1.0.0", { "@test/core": "<2" }),
  ]) {
    const response = await app.inject({ method: "POST", url: "/api/v1/packages", payload: payload(item) });
    assert.equal(response.statusCode, 201, response.body);
  }

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/resolve",
    payload: { packages: [{ name: "@test/a" }, { name: "@test/b" }] },
  });
  assert.equal(response.statusCode, 200, response.body);
  const resolved = response.json().packages as Array<{ name: string; version: string }>;
  assert.deepEqual(resolved.map((item) => `${item.name}@${item.version}`), [
    "@test/core@1.0.0",
    "@test/a@1.0.0",
    "@test/b@1.0.0",
  ]);
});

test("indexa conocimiento de paquetes y aísla memorias por proyecto", async () => {
  const knowledge: PackageManifest = {
    schemaVersion: 1,
    name: "@test/knowledge",
    version: "1.0.0",
    type: "knowledge",
    description: "Conocimiento de prueba",
    knowledge: [{ source: "guide.md", title: "Puertos y adaptadores", tags: ["hexagonal"] }],
  };
  const published = await app.inject({
    method: "POST",
    url: "/api/v1/packages",
    payload: payload(knowledge, { "guide.md": "El dominio depende de puertos, nunca de la base de datos." }),
  });
  assert.equal(published.statusCode, 201, published.body);

  const search = await app.inject({
    method: "POST",
    url: "/api/v1/knowledge/search",
    payload: { query: "dominio puertos" },
  });
  assert.equal(search.statusCode, 200, search.body);
  assert.equal(search.json().results[0].packageName, "@test/knowledge");

  const remembered = await app.inject({
    method: "POST",
    url: "/api/v1/memories",
    payload: { projectId: "project-a", kind: "decision", content: "Usamos UUID para las órdenes" },
  });
  assert.equal(remembered.statusCode, 201, remembered.body);
  const found = await app.inject({
    method: "POST",
    url: "/api/v1/memories/search",
    payload: { projectId: "project-a", query: "UUID" },
  });
  assert.equal(found.json().results.length, 1);
  const isolated = await app.inject({
    method: "POST",
    url: "/api/v1/memories/search",
    payload: { projectId: "project-b", query: "UUID" },
  });
  assert.equal(isolated.json().results.length, 0);
});

test("la CLI conserva al retirar un archivo modificado por el usuario", async () => {
  const packageManifest: PackageManifest = {
    ...manifest("@test/installable", "1.0.0"),
    files: [{ source: "content.txt", target: ".agents/content.txt" }],
  };
  const published = await app.inject({
    method: "POST",
    url: "/api/v1/packages",
    payload: payload(packageManifest, { "content.txt": "original" }),
  });
  assert.equal(published.statusCode, 201, published.body);

  const address = app.server.address() as AddressInfo;
  const api = new ApiClient(`http://127.0.0.1:${address.port}`);
  const projectRoot = mkdtempSync(join(root, "project-"));
  const project: ProjectManifest = {
    schemaVersion: 1,
    projectId: "project-install",
    packages: { "@test/installable": "*" },
  };
  const empty: ProjectLock = { schemaVersion: 1, generatedAt: new Date(0).toISOString(), packages: [] };
  const installed = await synchronize(api, projectRoot, project, empty);
  const target = join(projectRoot, ".agents", "content.txt");
  assert.equal(readFileSync(target, "utf8"), "original");

  writeFileSync(target, "cambio del usuario", "utf8");
  const removed = await synchronize(api, projectRoot, { ...project, packages: {} }, installed.lock);
  assert.equal(existsSync(target), true);
  assert.equal(removed.preserved.length, 1);
});

test("rechaza rutas que intentan salir del proyecto", async () => {
  const unsafe: PackageManifest = {
    ...manifest("@test/unsafe", "1.0.0"),
    files: [{ source: "file.txt", target: "../escape.txt" }],
  };
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/packages",
    payload: payload(unsafe, { "file.txt": "no" }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "UNSAFE_PATH");
});

test("permite deprecar y retirar versiones sin resolver una versión yanked", async () => {
  for (const version of ["1.0.0", "2.0.0"]) {
    const response = await app.inject({ method: "POST", url: "/api/v1/packages", payload: payload(manifest("@test/status", version)) });
    assert.equal(response.statusCode, 201, response.body);
  }
  const deprecated = await app.inject({ method: "POST", url: "/api/v1/admin/packages/deprecate", payload: { name: "@test/status", version: "1.0.0", message: "usa v2" } });
  assert.equal(deprecated.statusCode, 200, deprecated.body);
  const yanked = await app.inject({ method: "POST", url: "/api/v1/admin/packages/yank", payload: { name: "@test/status", version: "2.0.0", reason: "regresión" } });
  assert.equal(yanked.statusCode, 200, yanked.body);
  const resolved = await app.inject({ method: "POST", url: "/api/v1/resolve", payload: { packages: [{ name: "@test/status" }] } });
  assert.equal(resolved.json().packages[0].version, "1.0.0");
});

test("los overrides controlan dependencias transitivas", async () => {
  for (const item of [
    manifest("@override/core", "1.0.0"),
    manifest("@override/core", "2.0.0"),
    manifest("@override/app", "1.0.0", { "@override/core": "*" }),
  ]) {
    const response = await app.inject({ method: "POST", url: "/api/v1/packages", payload: payload(item) });
    assert.equal(response.statusCode, 201, response.body);
  }
  const resolved = await app.inject({ method: "POST", url: "/api/v1/resolve", payload: { packages: [{ name: "@override/app" }], overrides: { "@override/core": "1.0.0" } } });
  assert.deepEqual(resolved.json().packages.map((item: { version: string }) => item.version), ["1.0.0", "1.0.0"]);
});

test("verifica firmas Ed25519 y registra al publicador", async () => {
  const pair = generateKeyPairSync("ed25519");
  const input = payload(manifest("@signed/tool", "1.0.0"));
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  input.signature = {
    algorithm: "ed25519",
    publicKey,
    signature: sign(null, signaturePayload(input.manifest, input.files), pair.privateKey).toString("base64"),
  };
  const response = await app.inject({ method: "POST", url: "/api/v1/packages", payload: input });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(typeof response.json().package.signerFingerprint, "string");
});

test("actualiza y elimina memoria mediante API", async () => {
  const created = await app.inject({ method: "POST", url: "/api/v1/memories", payload: { projectId: "memory-crud", content: "valor inicial" } });
  const id = created.json().memory.id as string;
  const updated = await app.inject({ method: "PATCH", url: `/api/v1/memories/${id}`, payload: { content: "valor corregido", kind: "decision" } });
  assert.equal(updated.json().memory.content, "valor corregido");
  const removed = await app.inject({ method: "DELETE", url: `/api/v1/memories/${id}` });
  assert.equal(removed.statusCode, 204);
});

test("protege la administración y emite API keys con roles", async () => {
  const authRoot = mkdtempSync(join(root, "auth-"));
  const secured = await createApp({ databasePath: join(authRoot, "db.sqlite"), artifactDirectory: join(authRoot, "artifacts"), apiToken: "bootstrap-secret", logger: false });
  const denied = await secured.inject({ method: "GET", url: "/api/v1/packages" });
  assert.equal(denied.statusCode, 401);
  const created = await secured.inject({ method: "POST", url: "/api/v1/admin/api-keys", headers: { authorization: "Bearer bootstrap-secret" }, payload: { label: "publisher-test", role: "publisher" } });
  assert.equal(created.statusCode, 201, created.body);
  const token = created.json().key.token as string;
  const forbidden = await secured.inject({ method: "GET", url: "/api/v1/admin/api-keys", headers: { authorization: `Bearer ${token}` } });
  assert.equal(forbidden.statusCode, 403);
  const published = await secured.inject({ method: "POST", url: "/api/v1/packages", headers: { authorization: `Bearer ${token}` }, payload: payload(manifest("@auth/tool", "1.0.0")) });
  assert.equal(published.statusCode, 201, published.body);
  await secured.close();
});

test("crea y audita un harness reproducible", () => {
  const harnessRoot = mkdtempSync(join(root, "harness-"));
  writeFileSync(join(harnessRoot, "package.json"), JSON.stringify({ scripts: { test: "node --test", build: "tsc" } }));
  const files = createHarness(harnessRoot);
  assert.equal(files.length, 6);
  const report = auditHarness(harnessRoot);
  assert.equal(report.score, 100);
  assert.equal(report.recommendations.length, 0);
});

test("exporta un snapshot administrable", async () => {
  const response = await app.inject({ method: "GET", url: "/api/v1/admin/export" });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().schemaVersion, 1);
  assert.ok(response.json().packages.length > 0);
});

test("el servidor no expone inferencia y recibe vectores calculados en clientes", async () => {
  for (const [method, url] of [["GET", "/api/v1/inference/status"], ["POST", "/api/v1/inference/chat"], ["POST", "/api/v1/knowledge/vectors/reindex"]] as const) {
    const response = await app.inject({ method, url });
    assert.equal(response.statusCode, 404, response.body);
  }
  const created = await app.inject({ method: "POST", url: "/api/v1/knowledge/documents", payload: { title: "Client embeddings", content: "El cliente ejecuta el modelo" } });
  const id = created.json().document.id;
  const saved = await app.inject({ method: "PUT", url: `/api/v1/knowledge/documents/${id}/vector`, payload: { model: "client-model", embedding: [1, 0, 0] } });
  assert.equal(saved.statusCode, 200, saved.body);
  const search = await app.inject({ method: "POST", url: "/api/v1/knowledge/vector-search", payload: { model: "client-model", embedding: [1, 0, 0] } });
  assert.equal(search.json().results[0].id, id);
  assert.equal(search.json().results[0].score, 1);
  const wrongModel = await app.inject({ method: "POST", url: "/api/v1/knowledge/vector-search", payload: { model: "other-model", embedding: [1, 0, 0] } });
  assert.deepEqual(wrongModel.json().results, []);
  const invalid = await app.inject({ method: "POST", url: "/api/v1/knowledge/vector-search", payload: { model: "client-model", embedding: [] } });
  assert.equal(invalid.statusCode, 400);
  const identity = await app.inject({ method: "GET", url: "/api/v1/session" });
  assert.equal(identity.json().role, "admin");
});

test("expone conocimiento y estado mediante un servidor MCP stdio real", async () => {
  const address = app.server.address() as AddressInfo;
  const projectRoot = mkdtempSync(join(root, "mcp-project-"));
  const modaiDir = join(projectRoot, ".modai");
  mkdirSync(modaiDir, { recursive: true });
  writeFileSync(join(modaiDir, "manifest.yaml"), `schemaVersion: 1\nprojectId: mcp-test\nserver: http://127.0.0.1:${address.port}\npackages: {}\noverrides: {}\n`);
  writeFileSync(join(modaiDir, "lock.yaml"), `schemaVersion: 1\ngeneratedAt: 2026-01-01T00:00:00.000Z\npackages: []\n`);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), join(process.cwd(), "src", "mcp.ts")],
    cwd: projectRoot,
    env: { ...getDefaultEnvironment(), MODAI_SERVER: `http://127.0.0.1:${address.port}` },
    stderr: "pipe",
  });
  const client = new Client({ name: "modai-test-client", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "modai_search_knowledge"));
  const called = await client.callTool({ name: "modai_project_status", arguments: {} });
  assert.match(JSON.stringify(called.content), /mcp-test/);
  await client.close();
});
