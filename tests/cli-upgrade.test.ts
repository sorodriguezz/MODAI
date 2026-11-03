import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { detectInstall, fetchDistTag, noticeEnabled } from "../packages/cli/src/cli/upgrade.ts";

const config = mkdtempSync(join(tmpdir(), "modai-upgrade-"));
let server: Server;
let registry = "";
before(async () => {
  server = createServer((request, response) => {
    if (request.url === "/-/package/@sorodriguez%2fmodai/dist-tags") return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ latest: "99.0.0", next: "100.0.0-beta.1" }));
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  registry = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => { server.close(); rmSync(config, { recursive: true, force: true }); });

// Asynchronous on purpose: the fake registry runs in this same process and must keep answering.
function cli(...args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise(resolve => execFile(process.execPath, ["--import", "tsx", "packages/cli/src/cli/index.ts", ...args], {
    encoding: "utf8", env: { ...process.env, MODAI_NPM_REGISTRY: registry, MODAI_CONFIG_DIR: config, MODAI_NO_UPDATE_NOTIFIER: "1" },
  }, (error, stdout, stderr) => resolve({ status: error ? Number(error.code ?? 1) : 0, stdout, stderr })));
}

test("modai upgrade consulta la etiqueta de npm y no instala sobre una CLI que no es global", async () => {
  process.env.MODAI_NPM_REGISTRY = registry;
  assert.equal(await fetchDistTag("next"), "100.0.0-beta.1");
  await assert.rejects(() => fetchDistTag("canary"), /No existe la etiqueta "canary"/);
  delete process.env.MODAI_NPM_REGISTRY;

  const check = await cli("upgrade", "--check");
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /→ 99\.0\.0\. Actualiza con: modai upgrade/);
  assert.equal(JSON.parse(readFileSync(join(config, "update-check.json"), "utf8")).latest, "99.0.0");

  // Run from the repository: there is nothing global to replace, so it explains instead of installing.
  const upgrade = await cli("upgrade", "--yes");
  assert.equal(upgrade.status, 0, upgrade.stderr);
  assert.match(upgrade.stdout, /no es una instalación global[\s\S]*npm install -g @sorodriguez\/modai@99\.0\.0/);
});

test("detecta cómo se instaló la CLI para usar el gestor correcto", () => {
  const entry = (prefix: string) => `${prefix}/node_modules/@sorodriguez/modai/dist/cli/index.js`;
  const npmRoot = () => "/usr/local/lib/node_modules";
  assert.deepEqual(detectInstall(entry("/usr/local/lib"), npmRoot), { kind: "npm", command: ["npm", "install", "-g"] });
  assert.equal(detectInstall(entry("/home/u/.npm/_npx/abc"), npmRoot).kind, "npx");
  assert.equal(detectInstall(entry("/home/u/.local/share/pnpm/global/5"), npmRoot).kind, "pnpm");
  assert.equal(detectInstall(entry("/home/u/.bun/install/global"), npmRoot).kind, "bun");
  assert.equal(detectInstall(entry("/home/u/proyecto"), npmRoot).kind, "source", "dependencia de un proyecto");
  assert.equal(detectInstall("/home/u/MODAI/packages/cli/dist/cli/index.js", npmRoot).kind, "source", "npm link desde el repositorio");
});

test("el aviso de versión nueva se desactiva en CI, en scripts y con MODAI_NO_UPDATE_NOTIFIER", () => {
  assert.equal(noticeEnabled({}, true), true);
  assert.equal(noticeEnabled({ CI: "true" }, true), false);
  assert.equal(noticeEnabled({ MODAI_NO_UPDATE_NOTIFIER: "1" }, true), false);
  assert.equal(noticeEnabled({}, false), false, "sin terminal interactiva");
});
