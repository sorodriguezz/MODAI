import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadPackageSource, normalizeManifest, validatePackage } from "@modai/core";
import { createComponentPackage } from "../src/authoring/component-package.ts";
import { listRows } from "../src/services/catalog.ts";
import { formatTable } from "../src/terminal/output.ts";

const root = mkdtempSync(join(tmpdir(), "modai-list-"));
after(() => rmSync(root, { recursive: true, force: true }));

const entry = (name: string, spec: Record<string, unknown>, kind = "Package") => ({
  name,
  version: "1.0.0",
  installed: true,
  manifest: normalizeManifest({
    apiVersion: "modai.dev/v1",
    kind,
    metadata: { name, version: "1.0.0", description: `${name} de prueba` },
    spec,
  }),
});

test("modai list filtra por contribución, kind o categoría (harness, components, profiles…)", () => {
  const entries = [
    entry("@harness/team", { category: "harness" }),
    entry("@acme/auth", {
      category: "backend",
      permissions: ["project.source"],
      contributes: { components: [{ name: "auth", path: "c", target: "src/{component}", language: "nestjs" }] },
    }),
    entry("@profiles/full", { dependencies: { "@acme/auth": "^1.0.0" } }, "Profile"),
  ];
  assert.deepEqual(
    listRows("harness", entries).rows.map((row) => row.package),
    ["@harness/team"],
  );
  assert.deepEqual(
    listRows("harnesses", entries).rows.map((row) => row.package),
    ["@harness/team"],
  );
  assert.deepEqual(listRows("components", entries).rows, [
    {
      component: "auth",
      package: "@acme/auth",
      version: "1.0.0",
      target: "src/auth",
      language: "nestjs",
      description: undefined,
    },
  ]);
  assert.deepEqual(
    listRows("profiles", entries).rows.map((row) => row.package),
    ["@profiles/full"],
  );
  assert.equal(listRows("packages", entries).rows.length, 3);
  assert.equal(listRows("backend", entries).rows[0].package, "@acme/auth");
  assert.equal(listRows("tools", entries).rows.length, 0);
  assert.match(
    formatTable(listRows("components", entries).rows),
    /^COMPONENT\s+PACKAGE\s+VERSION\s+TARGET\s+LANGUAGE\nauth\s+@acme\/auth/,
  );
});

test("modai component create empaqueta código existente como componente válido", () => {
  const code = join(root, "code", "billing");
  mkdirSync(join(code, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(code, "billing.service.ts"), "export class BillingService {}\n");
  writeFileSync(join(code, "node_modules", "dep", "index.js"), "ignored");
  const directory = createComponentPackage(join(root, "pkg"), {
    name: "@acme/billing",
    from: code,
    language: "nestjs",
  });
  assert.match(readFileSync(join(directory, "modai.package.yaml"), "utf8"), /target: src\/modules\/\{component\}/);
  const input = loadPackageSource(directory);
  assert.deepEqual(
    input.files.map((file) => file.path),
    ["component/billing.service.ts"],
  );
  const manifest = validatePackage(input.manifest, input.files);
  assert.equal(manifest.spec.contributes.components[0].name, "billing");
  assert.throws(() => createComponentPackage(directory, { name: "@acme/billing" }), /ya existe/);
});
