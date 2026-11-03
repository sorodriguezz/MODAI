import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readZip, skillArchiveToPackage, writeZip } from "../packages/core/src/index.js";
import { applyVariables } from "../packages/cli/src/cli/commands/template.js";
import { createApp } from "../apps/server/src/http/app.js";
import { sha256 } from "../packages/contracts/src/security.js";

const root = mkdtempSync(join(tmpdir(), "modai-library-"));
const bootstrap = "library-bootstrap-secret";
const app = await createApp({ databasePath: join(root, "db.sqlite"), artifactDirectory: join(root, "artifacts"), apiToken: bootstrap, logger: false, adminDirectory: false, initialAdmin: false });
after(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const admin = as(bootstrap);
async function call(headers: Record<string, string>, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  const response = await app.inject({ method, url: "/api/v1" + url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: response.statusCode, body: response.headers["content-type"]?.toString().includes("json") ? response.json() : response.rawPayload };
}
const text = (value: string) => Buffer.from(value, "utf8");
const skillZip = writeZip([
  { path: "code-review/SKILL.md", bytes: text("---\nname: code-review\ndescription: Revisa cambios buscando errores de lógica y regresiones.\n---\n\n# Revisión de código\n") },
  { path: "code-review/references/checklist.md", bytes: text("# Checklist\n") },
  { path: "__MACOSX/code-review/._SKILL.md", bytes: text("basura") },
]);

test("ZIP: lo escrito se lee igual, sin entradas de sistema ni rutas peligrosas", () => {
  const entries = readZip(skillZip);
  assert.deepEqual(entries.map(entry => entry.path), ["code-review/SKILL.md", "code-review/references/checklist.md"]);
  assert.equal(entries[1]!.bytes.toString(), "# Checklist\n");
  assert.deepEqual(writeZip(entries), writeZip(entries), "misma entrada, mismos bytes");
  assert.throws(() => readZip(writeZip([{ path: "../fuera.txt", bytes: text("x") }])));
  assert.throws(() => readZip(text("no es un zip")), /ZIP/);
});

test("un .skill se convierte en un paquete v1 con la skill y su frontmatter", () => {
  const converted = skillArchiveToPackage(skillZip, { namespace: "@skills" });
  const manifest = converted.manifest as unknown as { metadata: { name: string; version: string; description: string }; spec: { contributes: { skills: Array<{ name: string; path: string }> } } };
  assert.equal(manifest.metadata.name, "@skills/code-review");
  assert.equal(manifest.metadata.version, "1.0.0");
  assert.match(manifest.metadata.description, /errores de lógica/);
  assert.deepEqual(manifest.spec.contributes.skills, [{ name: "code-review", path: "skills/code-review" }]);
  assert.deepEqual(converted.files.map(file => file.path), ["skills/code-review/SKILL.md", "skills/code-review/references/checklist.md"]);
  assert.throws(() => skillArchiveToPackage(writeZip([{ path: "README.md", bytes: text("x") }]), { namespace: "@skills" }), /SKILL\.md/);
});

test("el servidor previsualiza e importa un .skill respetando el namespace", async () => {
  const archive = skillZip.toString("base64");
  const preview = await call(admin, "POST", "/packages/import-skill", { archive, namespace: "@skills", version: "2.0.0", dryRun: true });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.name, "@skills/code-review");
  assert.equal(preview.body.files.length, 2);
  assert.equal(typeof preview.body.quality.score, "number");
  assert.equal((await call(admin, "GET", "/package?name=" + encodeURIComponent("@skills/code-review"))).status, 404, "dryRun no publica");

  const outsider = as((await call(admin, "POST", "/admin/api-keys", { label: "pub", role: "publisher", packageScopes: ["@otro"] })).body.key.token);
  assert.equal((await call(outsider, "POST", "/packages/import-skill", { archive, namespace: "@skills" })).status, 403);
  const published = await call(admin, "POST", "/packages/import-skill", { archive, namespace: "@skills", version: "2.0.0" });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  assert.equal(published.body.package.version, "2.0.0");
  assert.equal((await call(admin, "POST", "/packages/import-skill", { archive: text("x").toString("base64"), namespace: "@skills" })).body.error.code, "INVALID_SKILL");
});

test("los templates se publican desde archivos o ZIP, son inmutables y siguen la visibilidad del namespace", async () => {
  const file = (path: string, content: string) => ({ path, content: Buffer.from(content).toString("base64"), sha256: sha256(Buffer.from(content)) });
  const files = [file("package.json", '{ "name": "{{projectName}}" }\n'), file("src/main.ts", "console.log('hola');\n"), file(".env", "SECRET=1"), file(".env.example", "PORT=3000"), file("node_modules/x/index.js", "x")];
  const first = await call(admin, "POST", "/templates", { name: "@plantillas/nestjs-sdd", version: "1.0.0", description: "NestJS con SDD", stack: "NestJS · SDD", tags: ["backend"], files });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.template.files, 3, ".env y node_modules quedan fuera");
  assert.equal((await call(admin, "POST", "/templates", { name: "@plantillas/nestjs-sdd", version: "1.0.0", description: "otra", files })).body.error.code, "TEMPLATE_EXISTS");
  const zip = writeZip([{ path: "nestjs-sdd/package.json", bytes: text('{ "name": "{{projectName}}", "version": "2" }\n') }, { path: "nestjs-sdd/README.md", bytes: text("# {{projectName}}\n") }]);
  assert.equal((await call(admin, "POST", "/templates", { name: "@plantillas/nestjs-sdd", version: "1.1.0", description: "NestJS con SDD", archive: zip.toString("base64") })).status, 201);

  const list = (await call(admin, "GET", "/templates")).body.templates;
  assert.deepEqual(list.map((t: { name: string; version: string; versions: number }) => [t.name, t.version, t.versions]), [["@plantillas/nestjs-sdd", "1.1.0", 2]]);
  const latest = (await call(admin, "GET", "/template/files?name=" + encodeURIComponent("@plantillas/nestjs-sdd"))).body;
  assert.deepEqual(latest.files.map((f: { path: string }) => f.path), ["README.md", "package.json"], "la carpeta raíz del ZIP se quita");
  const download = await app.inject({ method: "GET", url: "/api/v1/template/download?name=" + encodeURIComponent("@plantillas/nestjs-sdd") + "&version=1.0.0", headers: admin });
  assert.equal(download.headers["content-type"], "application/zip");
  assert.deepEqual(readZip(download.rawPayload).map(entry => entry.path), ["nestjs-sdd/.env.example", "nestjs-sdd/package.json", "nestjs-sdd/src/main.ts"]);

  assert.equal((await call(admin, "PATCH", "/templates", { name: "@plantillas/nestjs-sdd", version: "1.1.0", status: "yanked" })).status, 200);
  assert.equal((await call(admin, "GET", "/templates")).body.templates[0].version, "1.0.0", "retirada no es la última");

  assert.equal((await call(admin, "POST", "/namespaces", { name: "@privado", visibility: "restricted" })).status, 201);
  assert.equal((await call(admin, "POST", "/templates", { name: "@privado/interno", version: "1.0.0", description: "Solo equipo", files: [file("a.txt", "a")] })).status, 201);
  const reader = as((await call(admin, "POST", "/admin/api-keys", { label: "lector", role: "reader" })).body.key.token);
  assert.deepEqual((await call(reader, "GET", "/templates")).body.templates.map((t: { name: string }) => t.name), ["@plantillas/nestjs-sdd"]);
  assert.equal((await call(reader, "GET", "/template/files?name=" + encodeURIComponent("@privado/interno"))).status, 404);
  assert.equal((await call(reader, "POST", "/templates", { name: "@plantillas/otro", version: "1.0.0", description: "x", files })).status, 403);

  const backup = (await call(admin, "GET", "/admin/export")).body;
  assert.equal(backup.templates.length, 3);
  assert.equal(backup.templates.find((t: { version: string; name: string }) => t.name === "@plantillas/nestjs-sdd" && t.version === "1.1.0").status, "yanked");
});

test("modai template use reemplaza marcadores conocidos y deja el resto", () => {
  assert.equal(applyVariables('{ "name": "{{projectName}}", "x": "{{ otro }}" }', { projectName: "mi-app" }), '{ "name": "mi-app", "x": "{{ otro }}" }');
});

test("la depuración separa auditoría y memorias, y puede contar sin borrar", async () => {
  const count = (await call(admin, "POST", "/admin/prune", { auditDays: 0, dryRun: true })).body;
  assert.equal(count.memories, 0);
  assert.ok(count.audit > 0);
  assert.equal(count.dryRun, true);
  const pruned = (await call(admin, "POST", "/admin/prune", { auditDays: 0 })).body;
  assert.equal(pruned.audit, count.audit);
  assert.equal((await call(admin, "GET", "/admin/audit")).body.events.length, 1, "solo queda el registro de la depuración");
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/prune", headers: admin })).statusCode, 200, "sin cuerpo usa los valores históricos");
});

test("la CLI publica un .skill y crea proyectos desde un template", async () => {
  const { execFile } = await import("node:child_process");
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  await app.listen({ host: "127.0.0.1", port: 0 });
  const server = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const env = { ...process.env, MODAI_SERVER: server, MODAI_API_TOKEN: bootstrap, MODAI_CONFIG_DIR: join(root, "config"), MODAI_NO_UPDATE_NOTIFIER: "1", MODAI_NO_USAGE_REPORT: "1" };
  const modai = (...args: string[]) => new Promise<{ status: number; stdout: string; stderr: string }>(resolve => execFile(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), join(process.cwd(), "packages/cli/src/cli/index.ts"), ...args], { cwd: root, env, encoding: "utf8" },
    (error, stdout, stderr) => resolve({ status: error ? Number(error.code ?? 1) : 0, stdout, stderr })));

  writeFileSync(join(root, "review.skill"), skillZip);
  const skill = await modai("package", "publish", "review.skill", "--namespace", "@cli");
  assert.equal(skill.status, 0, skill.stderr);
  assert.match(skill.stdout, /@cli\/code-review@1\.0\.0/);

  const model = join(root, "modelo");
  mkdirSync(join(model, "src"), { recursive: true });
  writeFileSync(join(model, "package.json"), '{ "name": "{{projectName}}", "owner": "{{owner}}" }\n');
  writeFileSync(join(model, "src", "{{projectName}}.module.ts"), "export class {{projectName}} {}\n");
  writeFileSync(join(model, ".env"), "SECRET=no-subir");
  const published = await modai("template", "publish", model, "--name", "@cli/nest@1.0.0", "--description", "Plantilla de prueba", "--stack", "NestJS");
  assert.equal(published.status, 0, published.stderr);
  const used = await modai("template", "use", "@cli/nest@1.0.0", "mi-app", "--var", "owner=equipo");
  assert.equal(used.status, 0, used.stderr);
  assert.equal(readFileSync(join(root, "mi-app", "package.json"), "utf8"), '{ "name": "mi-app", "owner": "equipo" }\n');
  assert.ok(existsSync(join(root, "mi-app", "src", "mi-app.module.ts")));
  assert.ok(!existsSync(join(root, "mi-app", ".env")), "los .env no se publican");
  assert.notEqual((await modai("template", "use", "@cli/nest", "mi-app")).status, 0, "no escribe sobre una carpeta con archivos");
});

test("la misma CLI gestiona skills, conocimiento, memoria, templates, usuarios y namespaces", async () => {
  const { execFile } = await import("node:child_process");
  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  if (!app.server.listening) await app.listen({ host: "127.0.0.1", port: 0 });
  const server = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const env = { ...process.env, MODAI_SERVER: server, MODAI_API_TOKEN: bootstrap, MODAI_CONFIG_DIR: join(root, "config"), MODAI_NO_UPDATE_NOTIFIER: "1", MODAI_NO_USAGE_REPORT: "1" };
  const modai = async (...args: string[]) => {
    const result = await new Promise<{ status: number; stdout: string; stderr: string }>(resolve => execFile(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), join(process.cwd(), "packages/cli/src/cli/index.ts"), ...args], { cwd: root, env, encoding: "utf8" },
      (error, stdout, stderr) => resolve({ status: error ? Number(error.code ?? 1) : 0, stdout, stderr })));
    assert.equal(result.status, 0, `modai ${args.join(" ")}\n${result.stderr}`);
    return result.stdout;
  };
  const json = async (...args: string[]) => JSON.parse(await modai("--json", ...args));

  // Skills: a folder with SKILL.md is published like a .skill, and exported back as one.
  const folder = join(root, "deploy-check");
  mkdirSync(join(folder, "references"), { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), "---\nname: deploy-check\ndescription: Verifica un despliegue antes de anunciarlo.\n---\n\n# Deploy check\n");
  writeFileSync(join(folder, "references", "pasos.md"), "# Pasos\n");
  assert.match(await modai("skill", "publish", folder, "--namespace", "@cli-skills", "--dry-run"), /deploy-check/);
  assert.match(await modai("skill", "publish", folder, "--namespace", "@cli-skills"), /@cli-skills\/deploy-check@1\.0\.0/);
  assert.ok((await json("skill", "list")).some((item: { name: string }) => item.name === "@cli-skills/deploy-check"));
  await modai("skill", "export", "@cli-skills/deploy-check", join(root, "exportada.skill"));
  assert.deepEqual(readZip(readFileSync(join(root, "exportada.skill"))).map(entry => entry.path), ["deploy-check/SKILL.md", "deploy-check/references/pasos.md"]);
  await modai("package", "deprecate", "@cli-skills/deploy-check@1.0.0", "--message", "Usa la 2.x");

  // Shared knowledge on the server.
  writeFileSync(join(root, "guia.md"), "# Guía de despliegue\n\nSiempre con feature flags.\n");
  const created = (await modai("knowledge", "add", "--title", "Guía de despliegue", "--file", join(root, "guia.md"), "--tags", "deploy,flags")).match(/creado: (\S+)/)![1]!;
  assert.ok((await json("knowledge", "list", "--manual")).some((doc: { id: string }) => doc.id === created));
  await modai("knowledge", "update", created, "--title", "Guía de despliegues");
  assert.equal((await json("knowledge", "show", created)).title, "Guía de despliegues");
  await modai("knowledge", "remove", created);

  // Memory of a server project, without modai.yaml.
  await call(admin, "POST", "/projects", { id: "cli-mem", name: "CLI memoria" });
  await modai("memory", "add", "Usamos PostgreSQL 17", "--kind", "decision", "--project", "cli-mem");
  writeFileSync(join(root, "memorias.md"), "# Decisiones\n\n- Las fechas van en UTC\n- Nada de ORMs mágicos\n");
  assert.match(await modai("memory", "import", join(root, "memorias.md"), "--project", "cli-mem"), /Importadas 2/);
  assert.equal((await json("memory", "list", "--project", "cli-mem")).length, 3);
  await modai("memory", "export", join(root, "memorias.jsonl"), "--project", "cli-mem");
  assert.equal(readFileSync(join(root, "memorias.jsonl"), "utf8").trim().split("\n").length, 3);

  // Templates: versions and yank/restore.
  const model = join(root, "modelo-2");
  mkdirSync(model, { recursive: true });
  writeFileSync(join(model, "README.md"), "# {{projectName}}\n");
  await modai("template", "publish", model, "--name", "@cli/basico@1.0.0", "--description", "Básico");
  await modai("template", "publish", model, "--name", "@cli/basico@1.1.0", "--description", "Básico");
  await modai("template", "yank", "@cli/basico@1.1.0");
  assert.deepEqual((await json("template", "info", "@cli/basico")).versions, ["1.1.0 (retirada)", "1.0.0"]);
  await modai("template", "restore", "@cli/basico@1.1.0");
  assert.equal((await json("template", "info", "@cli/basico")).version, "1.1.0");

  // Users, namespaces and organizations.
  const org = (await call(admin, "POST", "/organizations", { name: "CLI Org" })).body.organization.id;
  await modai("admin", "update-namespace", "@cli-skills", "--organization", org, "--restricted");
  assert.ok((await json("admin", "namespaces")).some((ns: { name: string; visibility: string }) => ns.name === "@cli-skills" && ns.visibility === "restricted"));
  assert.match(await modai("admin", "create-user", "cli.ana", "--password", "contraseña-cli-segura", "--role", "publisher", "--organizations", org, "--scopes", "@cli-skills"), /cli\.ana/);
  const user = (await json("admin", "users")).find((item: { username: string }) => item.username === "cli.ana");
  assert.match(await modai("admin", "update-user", user.id, "--disable"), /desactivado/);
  await modai("admin", "delete-user", user.id);
  await modai("admin", "update-organization", org, "--description", "Equipo de la CLI");
  assert.ok((await json("admin", "audit", "--limit", "200")).some((event: { action: string }) => event.action === "user.delete"));
  assert.ok(!existsSync(join(root, "no-existe")));
});
