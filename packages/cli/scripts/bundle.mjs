import { chmodSync, copyFileSync, globSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
await build({
  absWorkingDir: root,
  entryPoints: globSync("src/**/*.ts", { cwd: root }),
  outdir: "dist",
  outbase: "src",
  bundle: true,
  splitting: true,
  chunkNames: "internal/chunks/[name]-[hash]",
  platform: "node",
  format: "esm",
  target: "node26",
  sourcemap: true,
  external: Object.keys(manifest.dependencies),
  alias: {
    "@modai/contracts": resolve(root, "../contracts/src/index.ts"),
    "@modai/contracts/types": resolve(root, "../contracts/src/types.ts"),
    "@modai/contracts/errors": resolve(root, "../contracts/src/errors.ts"),
    "@modai/contracts/schemas": resolve(root, "../contracts/src/schemas.ts"),
    "@modai/contracts/agent-tools": resolve(root, "../contracts/src/agent-tools.ts"),
    "@modai/contracts/manifest": resolve(root, "../contracts/src/manifest/index.ts"),
    "@modai/contracts/security": resolve(root, "../contracts/src/security/index.ts"),
    "@modai/contracts/quality": resolve(root, "../contracts/src/quality/package-quality.ts"),
    "@modai/sdk": resolve(root, "../sdk/src/index.ts"),
    "@modai/core": resolve(root, "../core/src/index.ts"),
    ...Object.fromEntries(
      globSync("**/*.ts", { cwd: resolve(root, "../core/src") }).map((file) => [
        "@modai/core/" + file.replaceAll("\\", "/").replace(/\.ts$/, ""),
        resolve(root, "../core/src", file),
      ]),
    ),
  },
});
for (const file of ["dist/bin/modai.js", "dist/bin/modai-mcp.js"]) chmodSync(resolve(root, file), 0o755);

mkdirSync(resolve(root, "dist/internal"), { recursive: true });
for (const [from, into] of [
  ["../contracts/dist", "dist/internal/contracts"],
  ["../sdk/dist", "dist/internal/sdk"],
]) {
  for (const file of globSync("**/*.d.ts", { cwd: resolve(root, from) })) {
    mkdirSync(dirname(resolve(root, into, file)), { recursive: true });
    copyFileSync(resolve(root, from, file), resolve(root, into, file));
  }
}
for (const file of globSync("dist/**/*.d.ts", { cwd: root })) {
  const declaration = resolve(root, file);
  let content = readFileSync(declaration, "utf8");
  for (const [name, target] of [
    ["@modai/contracts/types", "contracts/types.js"],
    ["@modai/sdk", "sdk/index.js"],
  ]) {
    let destination = relative(dirname(declaration), resolve(root, "dist/internal", target)).replaceAll("\\", "/");
    if (!destination.startsWith(".")) destination = "./" + destination;
    content = content.replaceAll('"' + name + '"', '"' + destination + '"');
  }
  writeFileSync(declaration, content);
}
