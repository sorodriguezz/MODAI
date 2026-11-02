// The CLI version lives in packages/cli/package.json and is repeated in sources bundled into the
// npm package. `set <version>` updates every copy; `check` fails when any copy disagrees (used by CI).
//   node scripts/cli-version.mjs set 0.7.0
//   node scripts/cli-version.mjs check
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const manifestPath = resolve(root, "packages/cli/package.json");
const COPIES = [
  { file: "packages/cli/src/cli/index.ts", pattern: /(\.version\(")([^"]+)("\))/ },
  { file: "packages/cli/src/mcp.ts", pattern: /(new Server\(\{ name: "modai", version: ")([^"]+)(")/ },
  { file: "packages/cli/src/agent/capabilities.ts", pattern: /(name: "modai-capabilities", version: ")([^"]+)(")/ },
  { file: "packages/core/src/version.ts", pattern: /(CORE_VERSION = ")([^"]+)(")/ },
];

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const [command, next] = process.argv.slice(2);

if (command === "set") {
  if (!SEMVER.test(next ?? "")) throw new Error(`Versión SemVer inválida: ${next}`);
  manifest.version = next;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const { file, pattern } of COPIES) {
    const path = resolve(root, file);
    const text = readFileSync(path, "utf8");
    if (!pattern.test(text)) throw new Error(`No se encontró la versión en ${file}`);
    writeFileSync(path, text.replace(pattern, `$1${next}$3`));
  }
  console.log(`CLI ${next}: actualizados package.json y ${COPIES.length} archivos. Recuerda el CHANGELOG.`);
} else if (command === "check") {
  const wrong = COPIES.flatMap(({ file, pattern }) => {
    const found = readFileSync(resolve(root, file), "utf8").match(pattern)?.[2];
    return found === manifest.version ? [] : [`${file}: ${found ?? "no encontrada"}`];
  });
  if (wrong.length) {
    console.error(`La versión de packages/cli/package.json es ${manifest.version}, pero difiere en:\n${wrong.join("\n")}\nCorrígelo con: node scripts/cli-version.mjs set ${manifest.version}`);
    process.exit(1);
  }
  console.log(manifest.version);
} else {
  console.error("Uso: node scripts/cli-version.mjs set <versión> | check");
  process.exit(2);
}
