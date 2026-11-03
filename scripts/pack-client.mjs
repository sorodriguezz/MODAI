import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "dist/npm");
mkdirSync(output, { recursive: true });
// Retire artifacts from the former scoped distribution.
for (const file of readdirSync(output))
  if (/^(modai-(contracts|sdk|cli)|moduleai)-.*\.tgz$/.test(file)) rmSync(resolve(output, file));
const result = spawnSync(
  "npm",
  ["pack", "--workspace", "@sorodriguez/modai", "--pack-destination", output, "--ignore-scripts", "--json"],
  { cwd: root, encoding: "utf8", shell: false },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.error?.message || "No se pudo empaquetar el CLI");
  process.exit(result.status ?? 1);
}
const [artifact] = JSON.parse(result.stdout);
console.log(`CLI listo: ${resolve(output, artifact.filename)} (${Math.ceil(artifact.size / 1024)} KiB)`);
