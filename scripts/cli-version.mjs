import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const MANIFESTS = [
  "package.json",
  "packages/contracts/package.json",
  "packages/sdk/package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "apps/server/package.json",
  "apps/admin/package.json",
];
const SOURCES = [
  { file: "packages/cli/src/bin/modai.ts", pattern: /(\.version\(")([^"]+)("\))/ },
  { file: "packages/cli/src/agents/capabilities.ts", pattern: /(name: "modai-capabilities", version: ")([^"]+)(")/ },
  { file: "packages/core/src/resolution/version.ts", pattern: /(CORE_VERSION = ")([^"]+)(")/ },
  { file: "apps/server/src/modules/admin/system.routes.ts", pattern: /(service: "modularai",\s*version: ")([^"]+)(")/ },
];
const INTERNAL = /^@modai\//;

const read = (file) => readFileSync(resolve(root, file), "utf8");
const cliVersion = () => JSON.parse(read("packages/cli/package.json")).version;

function copies() {
  const found = [];
  for (const file of MANIFESTS) {
    const manifest = JSON.parse(read(file));
    found.push({ where: `${file} (version)`, value: manifest.version });
    for (const field of ["dependencies", "devDependencies"])
      for (const [name, range] of Object.entries(manifest[field] ?? {}))
        if (INTERNAL.test(name)) found.push({ where: `${file} (${name})`, value: range });
  }
  for (const { file, pattern } of SOURCES) found.push({ where: file, value: read(file).match(pattern)?.[2] });
  return found;
}

const [command, next] = process.argv.slice(2);
if (command === "set") {
  if (!SEMVER.test(next ?? "")) throw new Error(`Versión SemVer inválida: ${next}`);
  for (const file of MANIFESTS) {
    const manifest = JSON.parse(read(file));
    manifest.version = next;
    for (const field of ["dependencies", "devDependencies"])
      for (const name of Object.keys(manifest[field] ?? {})) if (INTERNAL.test(name)) manifest[field][name] = next;
    writeFileSync(resolve(root, file), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  for (const { file, pattern } of SOURCES) {
    const text = read(file);
    if (!pattern.test(text)) throw new Error(`No se encontró la versión en ${file}`);
    writeFileSync(resolve(root, file), text.replace(pattern, `$1${next}$3`));
  }
  const lock = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (lock.status !== 0)
    throw new Error("No se pudo actualizar package-lock.json; ejecuta npm install --package-lock-only");
  console.log(
    `MODAI ${next}: ${MANIFESTS.length} package.json, ${SOURCES.length} archivos de código y package-lock.json. Recuerda el CHANGELOG.`,
  );
} else if (command === "check") {
  const expected = cliVersion();
  const wrong = copies().filter((item) => item.value !== expected);
  if (wrong.length) {
    console.error(
      `La versión del producto es ${expected} (packages/cli/package.json), pero difiere en:\n${wrong.map((item) => `${item.where}: ${item.value ?? "no encontrada"}`).join("\n")}\nCorrígelo con: node scripts/cli-version.mjs set ${expected}`,
    );
    process.exit(1);
  }
  console.log(expected);
} else {
  console.error("Uso: node scripts/cli-version.mjs set <versión> | check");
  process.exit(2);
}
