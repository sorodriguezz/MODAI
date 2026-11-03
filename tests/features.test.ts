import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import YAML from "yaml";
import { sha256 } from "@modai/contracts/security";
import {
  LocalRegistry, createProjectFile, effectiveFiles, effectiveManifest, loadPackageSource, normalizeManifest, parseFeatureFlags, saveProjectFile,
  selectFeatures, selectPackageFeatures, suggestFeature, validatePackage,
} from "@modai/core";

const root = mkdtempSync(join(tmpdir(), "modai-features-"));
after(() => rmSync(root, { recursive: true, force: true }));
const env = { ...process.env, MODAI_CONFIG_DIR: join(root, "config"), MODAI_NO_UPDATE_NOTIFIER: "1", MODAI_NO_USAGE_REPORT: "1", MODAI_SERVER: "", MODAI_API_TOKEN: "" };

function modai(cwd: string, ...args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise(resolve => execFile(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), join(process.cwd(), "packages/cli/src/cli/index.ts"), ...args], { cwd, env, encoding: "utf8" },
    (error, stdout, stderr) => resolve({ status: error ? Number(error.code ?? 1) : 0, stdout, stderr })));
}
const ok = async (cwd: string, ...args: string[]) => { const result = await modai(cwd, ...args); assert.equal(result.status, 0, `modai ${args.join(" ")}\n${result.stderr}`); return result.stdout; };

function writePackage(directory: string, manifest: Record<string, unknown>, files: Record<string, string>): string {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "modai.package.yaml"), YAML.stringify({ apiVersion: "modai.dev/v1", kind: "Package", ...manifest }));
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), content); }
  return directory;
}
const artifact = (files: Record<string, string>) => Object.entries(files).map(([path, text]) => ({ path, content: Buffer.from(text).toString("base64"), sha256: sha256(Buffer.from(text)) }));

/** A component with optional parts: what the CLI test installs and the unit tests inspect. */
const HEALTH = {
  metadata: { name: "@acme/health", version: "1.0.0", description: "Endpoint de health check modular con features opcionales para pruebas" },
  spec: {
    permissions: ["project.source"],
    contributes: { components: [{ name: "health", path: "component", target: "src/modules/{component}" }] },
    features: {
      metrics: { description: "Métricas Prometheus", default: true, overlays: [{ component: "health", path: "features/metrics" }] },
      tls: {
        description: "TLS en el endpoint", requires: ["metrics"], dependencies: { "@acme/certs": "^1.0.0" },
        contributes: { knowledge: [{ path: "features/tls/TLS.md", title: "Guía TLS" }] },
        overlays: [{ component: "health", path: "features/tls/component" }],
      },
      admin: { description: "Panel de administración", contributes: { components: [{ name: "health-admin", path: "features/admin/component", target: "src/modules/{component}" }] } },
      legacy: { description: "Modo compatible sin TLS", conflicts: ["tls"], overlays: [{ component: "health", path: "features/legacy" }] },
    },
  },
};
const HEALTH_FILES = {
  "component/health.ts": "export const health = 'base';\n",
  "component/README.md": "# Health base\n",
  "features/metrics/metrics.ts": "export const metrics = true;\n",
  "features/metrics/README.md": "# Health con métricas\n",
  "features/tls/TLS.md": "# TLS\n\nCómo rotar los certificados del endpoint.\n",
  "features/tls/component/tls.ts": "export const tls = true;\n",
  "features/admin/component/admin.ts": "export const admin = true;\n",
  "features/legacy/legacy.ts": "export const legacy = true;\n",
};

test("las features se eligen con defaults, requires y conflicts, y los flags --x / --no-x las expresan", () => {
  const rules = [
    { name: "metrics", description: "m", default: true, requires: [], conflicts: [] },
    { name: "tls", description: "t", default: false, requires: ["metrics"], conflicts: [] },
    { name: "legacy", description: "l", default: false, requires: [], conflicts: ["tls"] },
  ];
  assert.deepEqual(selectFeatures(rules, {}, "x"), ["metrics"]);
  assert.deepEqual(selectFeatures(rules, { metrics: false }, "x"), []);
  assert.deepEqual(selectFeatures(rules, { tls: true }, "x"), ["metrics", "tls"]);
  assert.throws(() => selectFeatures(rules, { tls: true, metrics: false }, "x"), /no se puede quitar "metrics" porque "tls" la requiere/);
  assert.throws(() => selectFeatures(rules, { tls: true, legacy: true }, "x"), /"tls" y "legacy" no se pueden combinar|"legacy" y "tls" no se pueden combinar/);
  assert.throws(() => selectFeatures(rules, { nope: true }, "x"), /no tiene la feature "nope".*Disponibles: metrics, tls, legacy/);
  assert.deepEqual(parseFeatureFlags(["--tls", "--no-metrics", "--raro", "-x"], ["tls", "metrics"]), { choice: { tls: true, metrics: false }, unknown: ["--raro", "-x"] });
  assert.equal(suggestFeature("--tsl", ["tls", "metrics"]), "tls");
  assert.equal(suggestFeature("--no-metric", ["tls", "metrics"]), "metrics");
  assert.equal(suggestFeature("--kubernetes", ["tls", "metrics"]), undefined);
});

test("con features activas el paquete suma sus contribuciones y dependencias, y los overlays modifican el componente", () => {
  const manifest = validatePackage({ apiVersion: "modai.dev/v1", kind: "Package", ...HEALTH } as never, artifact(HEALTH_FILES));
  const selected = selectPackageFeatures(manifest, { tls: true, admin: true });
  assert.deepEqual(selected, ["metrics", "tls", "admin"]);
  const effective = effectiveManifest(manifest, selected);
  assert.deepEqual(effective.spec.dependencies, { "@acme/certs": "^1.0.0" });
  assert.deepEqual(effective.spec.contributes.components.map(item => item.name), ["health", "health-admin"]);
  assert.deepEqual(effective.spec.contributes.knowledge.map(item => item.path), ["features/tls/TLS.md"]);
  const files = effectiveFiles(manifest, new Map(Object.entries(HEALTH_FILES).map(([path, text]) => [path, Buffer.from(text)])), selected);
  assert.equal(files.get("component/README.md")!.toString(), "# Health con métricas\n", "un overlay reemplaza un archivo del componente");
  assert.ok(files.has("component/metrics.ts") && files.has("component/tls.ts"));
  assert.ok(!files.has("component/legacy.ts"), "las features inactivas no tocan nada");
  assert.equal(effectiveManifest(manifest, []), manifest);
});

test("la validación rechaza features mal declaradas al publicar", () => {
  const check = (features: Record<string, unknown>, files: Record<string, string> = HEALTH_FILES, extra: Record<string, unknown> = {}) =>
    () => validatePackage({ apiVersion: "modai.dev/v1", kind: "Package", metadata: HEALTH.metadata, spec: { ...HEALTH.spec, ...extra, features } } as never, artifact(files));
  assert.throws(check({ "no-tls": { description: "x", requires: [] } }), /no-tls|minúsculas|no-/);
  assert.throws(check({ a: { description: "a", requires: ["b"] }, b: { description: "b", requires: ["a"] } }), /ciclo/);
  assert.throws(check({ a: { description: "a" } }), /no aporta nada/);
  assert.throws(check({ a: { description: "a", requires: ["fantasma"] } }), /fantasma/);
  assert.throws(check({ a: { description: "a", overlays: [{ component: "otro", path: "features/metrics" }] } }), /componente "otro"/);
  assert.throws(check({ a: { description: "a", overlays: [{ component: "health", path: "features/vacia" }] } }), /no tiene archivos/);
  assert.throws(check({ a: { description: "a", overlays: [{ component: "health", path: "component/extra" }] } }, { ...HEALTH_FILES, "component/extra/x.ts": "x" }), /dentro de component/);
  assert.throws(check({ a: { description: "a", dependencies: { "@acme/health": "^1.0.0" } } }), /propio paquete/);
  assert.throws(check({ a: { description: "a", default: true, conflicts: ["b"] }, b: { description: "b", default: true, overlays: [{ component: "health", path: "features/legacy" }] } }), /no se pueden combinar/);
  assert.throws(check({ a: { description: "a", contributes: { components: [{ name: "health", path: "features/admin/component", target: "src/{component}" }] } } }), /Componente duplicado: health/);
  assert.throws(check({ a: { description: "a", contributes: { tools: [{ name: "t", description: "t", command: "node", inputSchema: { type: "object" } }] } } }), /process\.execute/);
});

test("modai add con flags por paquete, modai feature y sync reproducen las features elegidas", async () => {
  const registry = new LocalRegistry(join(root, "registry"));
  await registry.publish(loadPackageSource(writePackage(join(root, "src", "certs"), { metadata: { name: "@acme/certs", version: "1.0.0", description: "Certificados de prueba para la feature tls del health check" }, spec: { contributes: { knowledge: [{ path: "CERTS.md", title: "Certificados" }] } } }, { "CERTS.md": "# Certs\n" })));
  await registry.publish(loadPackageSource(writePackage(join(root, "src", "health"), HEALTH, HEALTH_FILES)));
  await registry.publish(loadPackageSource(writePackage(join(root, "src", "plain"), { metadata: { name: "@acme/plain", version: "1.0.0", description: "Paquete sin features para comprobar los mensajes" }, spec: { contributes: { knowledge: [{ path: "P.md", title: "P" }] } } }, { "P.md": "# P\n" })));
  const project = join(root, "app");
  mkdirSync(project, { recursive: true });
  saveProjectFile(project, createProjectFile("app", { registries: [{ name: "local", path: join(root, "registry") }], adapters: [] }));
  const read = (path: string) => readFileSync(join(project, path), "utf8");
  const yaml = () => YAML.parse(read("modai.yaml"));
  const lock = () => YAML.parse(read("modai.lock"));

  // --help shows what the package declares, also before installing it.
  const help = await ok(project, "add", "@acme/health", "--help");
  assert.match(help, /Opciones de este paquete:/);
  assert.match(help, /--metrics \/ --no-metrics\s+Métricas Prometheus \(activada por defecto; modifica health\)/);
  assert.match(help, /--tls\s+TLS en el endpoint \(requiere metrics; añade 1 documento\(s\); modifica health; instala @acme\/certs\)/);
  assert.match(help, /--legacy\s+Modo compatible sin TLS \(no combina con tls/);
  assert.match(await ok(project, "add", "@acme/plain", "-h"), /no declara features/);
  assert.match(await ok(project, "add", "--help"), /Cada flag se aplica al paquete escrito antes/);

  // Typos and impossible combinations fail before touching the project.
  const typo = await modai(project, "add", "@acme/health", "--tsl", "--allow", "project.source");
  assert.notEqual(typo.status, 0);
  assert.match(typo.stderr, /no tiene la opción --tsl\. ¿Quisiste decir --tls\?/);
  const clash = await modai(project, "add", "@acme/health", "--tls", "--legacy", "--allow", "project.source");
  assert.notEqual(clash.status, 0);
  assert.match(clash.stderr, /no se pueden combinar/);
  assert.ok(!existsSync(join(project, "src")));
  assert.deepEqual(yaml().dependencies ?? {}, {}, "modai.yaml no cambia si la instalación falla");

  // Flags belong to the package written before them.
  const added = await ok(project, "add", "@acme/health", "--tls", "@acme/plain", "--allow", "project.source");
  assert.match(added, /Features: @acme\/health \(metrics, tls\)/);
  assert.deepEqual(yaml().features, { "@acme/health": { tls: true } });
  assert.deepEqual(lock().packages["@acme/health"].features, ["metrics", "tls"]);
  assert.ok(lock().packages["@acme/certs"], "la dependencia de la feature tls se instala");
  assert.equal(read("src/modules/health/README.md"), "# Health con métricas\n");
  assert.ok(existsSync(join(project, "src/modules/health/tls.ts")) && existsSync(join(project, "src/modules/health/metrics.ts")));
  assert.ok(!existsSync(join(project, "src/modules/health/legacy.ts")));
  assert.ok(!existsSync(join(project, "src/modules/health-admin")));

  // modai feature: list, enable, disable (respecting requires) and reset.
  const listed = JSON.parse(await ok(project, "--json", "feature", "list", "@acme/health"));
  assert.deepEqual(listed.map((row: { feature: string; active: boolean; choice: string }) => [row.feature, row.active, row.choice]), [["metrics", true, "por defecto"], ["tls", true, "activada"], ["admin", false, "por defecto"], ["legacy", false, "por defecto"]]);
  const blocked = await modai(project, "feature", "disable", "@acme/health", "metrics");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /no se puede quitar "metrics" porque "tls" la requiere/);
  assert.match(await ok(project, "feature", "disable", "@acme/health", "tls"), /Features activas: metrics \(antes: metrics, tls\)/);
  assert.ok(!existsSync(join(project, "src/modules/health/tls.ts")), "al quitar una feature se retiran sus archivos");
  assert.ok(!lock().packages["@acme/certs"], "y su dependencia");
  await ok(project, "feature", "enable", "@acme/health", "admin");
  assert.equal(read("src/modules/health-admin/admin.ts"), "export const admin = true;\n");
  await ok(project, "feature", "disable", "@acme/health", "metrics");
  assert.equal(read("src/modules/health/README.md"), "# Health base\n", "sin el overlay vuelve el archivo del componente base");
  assert.ok(!existsSync(join(project, "src/modules/health/metrics.ts")));
  assert.deepEqual(yaml().features, { "@acme/health": { admin: true, metrics: false, tls: false } });
  const unknown = await modai(project, "feature", "enable", "@acme/health", "metricss");
  assert.match(unknown.stderr, /¿Quisiste decir "metrics"\?/);

  // The project rebuilds exactly from modai.yaml + modai.lock.
  rmSync(join(project, "src"), { recursive: true, force: true });
  rmSync(join(project, ".modai", "store"), { recursive: true, force: true });
  await ok(project, "sync", "--frozen");
  assert.ok(existsSync(join(project, "src/modules/health-admin/admin.ts")));
  assert.ok(!existsSync(join(project, "src/modules/health/metrics.ts")));
  const status = JSON.parse(await ok(project, "--json", "status"));
  assert.deepEqual(status.installed.find((item: { name: string }) => item.name === "@acme/health").features, ["admin"]);

  // reset goes back to the package's defaults and cleans modai.yaml.
  assert.match(await ok(project, "feature", "reset", "@acme/health"), /Features activas: metrics/);
  assert.equal(yaml().features, undefined);
  assert.ok(existsSync(join(project, "src/modules/health/metrics.ts")));
  assert.ok(!existsSync(join(project, "src/modules/health-admin")));

  // Adding again with new flags merges with what was chosen before.
  await ok(project, "add", "@acme/health", "--admin", "--no-metrics");
  assert.deepEqual(yaml().features, { "@acme/health": { admin: true, metrics: false } });
  assert.deepEqual(normalizeManifest(YAML.parse(readFileSync(join(root, "src", "health", "modai.package.yaml"), "utf8"))).spec.features.tls.requires, ["metrics"]);

  // Removing the package forgets its choices too.
  await ok(project, "remove", "@acme/health");
  assert.equal(yaml().features, undefined);
  assert.ok(!existsSync(join(project, "src/modules/health")));

  // modai workspace add takes the same flags and applies them in every project.
  const repos = join(root, "repos");
  for (const name of ["api", "web"]) {
    mkdirSync(join(repos, name), { recursive: true });
    saveProjectFile(join(repos, name), createProjectFile(name, { registries: [{ name: "local", path: join(root, "registry") }], adapters: [] }));
  }
  const typoAll = await modai(repos, "workspace", "add", "@acme/health", "--tsl", "--yes");
  assert.notEqual(typoAll.status, 0);
  assert.match(typoAll.stdout + typoAll.stderr, /api\s+error\s+@acme\/health no tiene la opción --tsl/);
  assert.match(typoAll.stdout, /No hay cambios que aplicar/);
  assert.ok(!existsSync(join(repos, "api", "modai.lock")) || !YAML.parse(readFileSync(join(repos, "api", "modai.lock"), "utf8")).packages?.["@acme/health"], "un flag mal escrito no instala nada");
  const all = await ok(repos, "workspace", "add", "@acme/health", "--tls", "--yes", "--allow", "project.source");
  assert.match(all, /features: @acme\/health \(metrics, tls\)/);
  for (const name of ["api", "web"]) {
    assert.ok(existsSync(join(repos, name, "src/modules/health/tls.ts")));
    assert.deepEqual(YAML.parse(readFileSync(join(repos, name, "modai.yaml"), "utf8")).features, { "@acme/health": { tls: true } });
  }
});

test("las correcciones de validación: Profiles, nombres reservados, features imposibles, carpetas solapadas y destinos de overlays", () => {
  const base = { apiVersion: "modai.dev/v1", metadata: HEALTH.metadata };
  const check = (features: Record<string, unknown>, files: Record<string, string> = HEALTH_FILES, kind = "Package") =>
    () => validatePackage({ ...base, kind, spec: { ...HEALTH.spec, features } } as never, artifact(files));
  // A Profile cannot sneak tools in through a feature.
  assert.throws(() => validatePackage({ ...base, kind: "Profile", spec: { permissions: ["process.execute"], features: { t: { description: "t", contributes: { tools: [{ name: "t", description: "t", command: "node", inputSchema: { type: "object" } }] } } } } } as never, artifact({})), /Profile/);
  // Names that commands already use as options.
  for (const name of ["sync", "root", "filter", "allow"]) assert.throws(check({ [name]: { description: "x", overlays: [{ component: "health", path: "features/metrics" }] } }), /reservado/);
  // a → b → c with a conflicting c can never be switched on.
  assert.throws(check({
    a: { description: "a", requires: ["b"], conflicts: ["c"] }, b: { description: "b", requires: ["c"] },
    c: { description: "c", overlays: [{ component: "health", path: "features/metrics" }] },
  }), /"a" no se puede activar nunca/);
  // A feature folder holds only that feature's files.
  assert.throws(check({
    admin: { description: "a", contributes: { components: [{ name: "health-admin", path: "features/admin", target: "src/modules/{component}" }] } },
    extra: { description: "e", overlays: [{ component: "health", path: "features/admin/extra" }] },
  }, { ...HEALTH_FILES, "features/admin/a.ts": "a", "features/admin/extra/secret.ts": "s" }), /se instalaría con ella/);
  assert.throws(check({ all: { description: "a", contributes: { components: [{ name: "everything", path: ".", target: "src/{component}" }] } } }), /raíz del paquete/);
  // Overlay files obey the same destinations as component files, at publish time.
  assert.throws(check({ x: { description: "x", overlays: [{ component: "health", path: "features/x" }] } }, { ...HEALTH_FILES, "features/x/.git/config": "x" }), /Destino reservado|UNSAFE|carpetas ocultas/);
  // Two features needing the same package keep both constraints.
  const manifest = validatePackage({ ...base, kind: "Package", spec: { ...HEALTH.spec, features: {
    a: { description: "a", dependencies: { "@x/y": "^1.0.0" } }, b: { description: "b", dependencies: { "@x/y": ">=1.2.0" } },
  } } } as never, artifact(HEALTH_FILES));
  assert.equal(effectiveManifest(manifest, ["a", "b"]).spec.dependencies["@x/y"], "^1.0.0 >=1.2.0");
});

test("el resolvedor avisa cuando las features elegidas dejan un paquete en una versión anterior", async () => {
  const pkg = (version: string, features: Record<string, unknown>) => ({ version, status: "active" as const, ref: version,
    manifest: normalizeManifest({ apiVersion: "modai.dev/v1", kind: "Package", metadata: { name: "@a/b", version, description: "Paquete de prueba del resolvedor con features" }, spec: { features } }) });
  const source = { versions: async () => [pkg("1.0.0", { tls: { description: "t", requires: [], dependencies: {} , contributes: { knowledge: [] }, overlays: [] } }), pkg("2.0.0", {})] };
  const { resolve } = await import("@modai/core");
  const kept = await resolve(source, { roots: [{ name: "@a/b" }], features: { "@a/b": { tls: true } }, checkCapabilities: false });
  assert.equal(kept.packages[0]!.version, "1.0.0");
  assert.match(kept.warnings.join("\n"), /Se usa @a\/b@1\.0\.0: la 2\.0\.0 no admite las features elegidas/);
  // With no version that fits, the error is the newest one's.
  await assert.rejects(resolve(source, { roots: [{ name: "@a/b", range: "^2.0.0" }], features: { "@a/b": { tls: true } }, checkCapabilities: false }), /@a\/b@2\.0\.0 no tiene la feature "tls"/);
});

test("los paquetes que un template añade a modai.yaml deben ser rangos SemVer del registry", async () => {
  const { parseTemplateManifest } = await import("@modai/core");
  assert.throws(() => parseTemplateManifest('features:\n  sdd:\n    description: x\n    packages:\n      "@m/sdd": "file:../../secreto"\n'), /rango SemVer/);
  assert.throws(() => parseTemplateManifest('features:\n  sdd:\n    description: x\n    packages:\n      "@m/sdd": latest\n'), /rango SemVer/);
  assert.equal(parseTemplateManifest('features:\n  sdd:\n    description: x\n    packages:\n      "@m/sdd": { version: "^1.2", features: [metrics] }\n').features[0]!.packages["@m/sdd"]!.version, "^1.2");
});

test("autorizar un paquete vale para sus features de ese momento: activar otra exige volver a autorizar", async () => {
  const registry = new LocalRegistry(join(root, "registry-tools"));
  const tool = (name: string) => ({ name, description: `Herramienta ${name}`, command: "node", args: [`\${packageDir}/tools/${name}.mjs`], inputSchema: { type: "object" } });
  await registry.publish(loadPackageSource(writePackage(join(root, "src", "tools"), {
    metadata: { name: "@acme/tools", version: "1.0.0", description: "Herramientas de prueba con una feature que añade otra herramienta" },
    spec: { permissions: ["process.execute"], include: ["tools"], contributes: { tools: [tool("safe")] }, features: { extra: { description: "Herramienta extra", contributes: { tools: [tool("extra")] } } } },
  }, { "tools/safe.mjs": "console.log(JSON.stringify({ ran: 'safe' }));\n", "tools/extra.mjs": "console.log(JSON.stringify({ ran: 'extra' }));\n" })));
  const project = join(root, "tools-app");
  mkdirSync(project, { recursive: true });
  saveProjectFile(project, createProjectFile("tools-app", { registries: [{ name: "local", path: join(root, "registry-tools") }], adapters: [] }));
  await ok(project, "add", "@acme/tools");
  await ok(project, "permissions", "grant", "@acme/tools", "--yes");
  assert.match(await ok(project, "capability", "run", "safe"), /safe/);
  const enabled = await ok(project, "feature", "enable", "@acme/tools", "extra");
  assert.match(enabled, /Requieren nueva autorización \(cambió su contenido o sus features\): modai permissions grant @acme\/tools/);
  const blocked = await modai(project, "capability", "run", "extra");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Las features cambiaron desde la autorización/);
  assert.notEqual((await modai(project, "capability", "run", "safe")).status, 0, "tampoco las que ya estaban: la autorización se revisa entera");
  const regrant = await ok(project, "permissions", "grant", "@acme/tools", "--yes");
  assert.match(regrant, /Features activas: extra/);
  assert.match(regrant, /Herramientas: safe → .*; extra →/);
  assert.match(await ok(project, "capability", "run", "extra"), /extra/);
});
