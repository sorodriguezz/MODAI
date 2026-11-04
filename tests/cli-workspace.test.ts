import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { createProjectFile, LocalRegistry, loadPackageSource, saveProjectFile } from "@modai/core";
import YAML from "yaml";
import { discoverProjects } from "../packages/cli/src/services/workspace.ts";

const root = mkdtempSync(join(tmpdir(), "modai-workspace-"));
const env = {
  ...process.env,
  MODAI_CONFIG_DIR: join(root, "config"),
  MODAI_NO_UPDATE_NOTIFIER: "1",
  MODAI_SERVER: "",
  MODAI_API_TOKEN: "",
};
let health: Server;
let healthUrl = "";
before(async () => {
  health = createServer((request, response) => {
    if (request.url === "/health")
      return void response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ status: "ok", service: "modularai", version: "0.7.1", apiVersion: 1 }));
    response
      .writeHead(401, { "content-type": "application/json" })
      .end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Credencial inválida" } }));
  });
  await new Promise<void>((resolve) => health.listen(0, "127.0.0.1", resolve));
  healthUrl = `http://127.0.0.1:${(health.address() as { port: number }).port}`;
});
after(() => {
  health.close();
  rmSync(root, { recursive: true, force: true });
});

function modai(cwd: string, ...args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      [
        join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        join(process.cwd(), "packages/cli/src/bin/modai.ts"),
        ...args,
      ],
      { cwd, env, encoding: "utf8" },
      (error, stdout, stderr) => resolve({ status: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
    ),
  );
}

function writePackage(directory: string, name: string, files: Record<string, string>) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "modai.package.yaml"),
    YAML.stringify({
      apiVersion: "modai.dev/v1",
      kind: "Package",
      metadata: { name, version: "1.0.0", description: `${name} para pruebas de workspace` },
      spec: { contributes: { knowledge: Object.keys(files).map((path) => ({ path, title: path })) } },
    }),
  );
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  return directory;
}

test("modai workspace instala en muchos proyectos con plan previo, sin seguir enlaces y aislando fallos", async () => {
  const registry = join(root, "registry");
  await new LocalRegistry(registry).publish(
    loadPackageSource(writePackage(join(root, "src", "guide"), "@acme/guide", { "guide.md": "# Guía\n" })),
  );
  const repos = join(root, "repos");
  const project = (path: string, dependencies: Record<string, string> = {}) => {
    mkdirSync(join(repos, path), { recursive: true });
    saveProjectFile(
      join(repos, path),
      createProjectFile(path.replaceAll("/", "-"), {
        registries: [{ name: "local", path: registry }],
        adapters: [],
        dependencies,
      }),
    );
  };
  project("api");
  project("web");
  project("libs/shared");
  project("api/node_modules/dep"); // never a target
  const outside = join(root, "outside");
  mkdirSync(outside);
  saveProjectFile(
    outside,
    createProjectFile("outside", { registries: [{ name: "local", path: registry }], adapters: [] }),
  );
  symlinkSync(outside, join(repos, "linked")); // a symlink cannot pull the walk outside the root

  assert.deepEqual(
    discoverProjects(repos).map((item) => item.path),
    ["api", "libs/shared", "web"],
  );
  assert.deepEqual(
    discoverProjects(repos, { filter: ["libs"] }).map((item) => item.path),
    ["libs/shared"],
  );

  const dry = await modai(repos, "workspace", "add", "@acme/guide", "--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /api\s+pendiente\s+añadirá @acme\/guide/);
  assert.equal(existsSync(join(repos, "api/modai.lock")), false, "--dry-run no cambia nada");

  const noTty = await modai(repos, "workspace", "add", "@acme/guide");
  assert.notEqual(noTty.status, 0, "sin terminal exige --yes");
  assert.match(noTty.stderr, /--yes/);

  // Another operation in progress on `web`: that project fails, the others are applied.
  mkdirSync(join(repos, "web/.modai"), { recursive: true });
  writeFileSync(join(repos, "web/.modai/.workspace.lock"), "99999 now\n");
  const run = await modai(repos, "--json", "workspace", "add", "@acme/guide", "--yes");
  assert.equal(run.status, 1);
  const results = Object.fromEntries(
    (JSON.parse(run.stdout) as Array<{ project: string; result: string; detail: string }>).map((item) => [
      item.project,
      item,
    ]),
  );
  assert.equal(results.api.result, "hecho");
  assert.equal(results["libs/shared"].result, "hecho");
  assert.equal(results.web.result, "error");
  assert.match(results.web.detail, /otra operación/);
  assert.match(readFileSync(join(repos, "api/modai.yaml"), "utf8"), /"?@acme\/guide"?: \^1\.0\.0/);
  assert.doesNotMatch(
    readFileSync(join(repos, "web/modai.yaml"), "utf8"),
    /@acme\/guide/,
    "un proyecto con error queda intacto",
  );
  assert.doesNotMatch(readFileSync(join(outside, "modai.yaml"), "utf8"), /@acme\/guide/);
  assert.equal(existsSync(join(repos, "api/.modai/.workspace.lock")), false, "el lock se libera");

  rmSync(join(repos, "web/.modai/.workspace.lock"));
  const second = await modai(repos, "--json", "workspace", "add", "@acme/guide", "--yes");
  assert.equal(second.status, 0, second.stderr);
  const after = Object.fromEntries(
    (JSON.parse(second.stdout) as Array<{ project: string; result: string }>).map((item) => [
      item.project,
      item.result,
    ]),
  );
  assert.deepEqual(
    [after.api, after.web],
    ["sin cambios", "hecho"],
    "repetir es seguro: lo ya hecho no se vuelve a tocar",
  );

  const removed = await modai(repos, "--json", "workspace", "remove", "@acme/guide", "--yes", "--filter", "api");
  assert.equal(removed.status, 0, removed.stderr);
  assert.doesNotMatch(readFileSync(join(repos, "api/modai.yaml"), "utf8"), /@acme\/guide/);
  assert.match(readFileSync(join(repos, "web/modai.yaml"), "utf8"), /@acme\/guide/);
});

test("modai server ping informa si el servidor está arriba, su latencia y si la credencial sirve", async () => {
  const up = await modai(root, "server", "ping", healthUrl);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /✓\s+Servidor\s+http:\/\/127\.0\.0\.1:\d+ · ok · \d+ ms/);
  assert.match(up.stdout, /Versión/);
  assert.match(up.stdout, /!\s+Credencial\s+no hay API key guardada/);

  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const closedPort = (closed.address() as { port: number }).port;
  await new Promise((resolve) => closed.close(resolve));
  const down = await modai(root, "--json", "server", "ping", `http://127.0.0.1:${closedPort}`, "--timeout", "2000");
  assert.equal(down.status, 1);
  const [server] = JSON.parse(down.stdout) as Array<{ status: string; detail: string }>;
  assert.equal(server.status, "error");
  assert.match(server.detail, /conexión rechazada/);

  const project = join(root, "ping-project");
  mkdirSync(project);
  saveProjectFile(
    project,
    createProjectFile("ping", {
      registries: [
        { name: "central", url: healthUrl },
        { name: "missing", path: "./no-existe" },
      ],
      adapters: [],
    }),
  );
  // The pre-0.9 spelling still works and says where the command lives now.
  const fromProject = await modai(project, "--json", "server", "ping");
  const checks = JSON.parse(fromProject.stdout) as Array<{ check: string; status: string }>;
  assert.ok(
    checks.some((item) => item.check === "Registry missing" && item.status === "aviso"),
    "revisa también los registries del proyecto",
  );
});

test("las salidas son tablas legibles por defecto y JSON con --json en cualquier comando", async () => {
  const project = join(root, "output-project");
  mkdirSync(project);
  saveProjectFile(
    project,
    createProjectFile("output", { registries: [{ name: "local", path: join(root, "registry") }], adapters: [] }),
  );
  const human = await modai(project, "status");
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /^Project: output$/m);
  const json = await modai(project, "status", "--json");
  assert.equal(JSON.parse(json.stdout).project, "output");
});

test("modai server logout olvida servidor y API key, conserva la confianza local y permite conectar otro servidor", async () => {
  const configDir = join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "client.yaml"),
    YAML.stringify({
      server: "https://viejo.example",
      token: "secreto",
      trustedPublishers: ["abc123"],
      signaturePolicy: "signed",
    }),
  );
  const out = await modai(root, "server", "logout");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Sesión cerrada en https:\/\/viejo\.example[\s\S]*modai server connect <url>/);
  const saved = YAML.parse(readFileSync(join(configDir, "client.yaml"), "utf8"));
  assert.deepEqual(saved, { trustedPublishers: ["abc123"], signaturePolicy: "signed" }, "la API key no queda en disco");
  const whoami = await modai(root, "server", "whoami");
  assert.match(whoami.stderr, /No hay servidor configurado/);
  assert.match((await modai(root, "server", "logout")).stdout, /No había ninguna sesión/);
});

test("los comandos están agrupados por dominio", async () => {
  const help = await modai(root, "--help");
  assert.equal(help.status, 0, help.stderr);
  for (const heading of ["Proyecto:", "Contexto y memoria:", "Publicar paquetes:", "Servidor:", "Este equipo:"])
    assert.ok(help.stdout.includes(heading), heading);
  for (const moved of [
    "remember",
    "recall",
    "forget",
    "publish",
    "yank",
    "grant",
    "trust",
    "providers",
    "worker",
    "connect",
    "ping",
  ]) {
    assert.doesNotMatch(
      help.stdout,
      new RegExp(`^  ${moved}\\b`, "m"),
      `${moved} aparece dentro de su grupo, no suelto en la ayuda`,
    );
  }
  assert.equal((await modai(root, "server", "connect", "--help")).status, 0);
});
