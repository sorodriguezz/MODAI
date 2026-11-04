import { copyFileSync, mkdirSync, watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const watching = process.argv.includes("--watch");
const STATIC = { "index.html": "index.html", "favicon.svg": "favicon.svg", "app/theme.js": "theme.js" };
mkdirSync(resolve(root, "dist"), { recursive: true });
const copy = () => {
  for (const [source, target] of Object.entries(STATIC))
    copyFileSync(resolve(root, "src", source), resolve(root, "dist", target));
};
copy();
const shared = { bundle: true, minify: !watching, legalComments: "none", logLevel: "info" };
const bundles = [
  {
    ...shared,
    entryPoints: [resolve(root, "src/main.js")],
    outfile: resolve(root, "dist/main.js"),
    format: "esm",
    platform: "browser",
    target: "es2022",
  },
  { ...shared, entryPoints: [resolve(root, "src/styles/index.css")], outfile: resolve(root, "dist/styles.css") },
];
if (watching) {
  for (const options of bundles) await (await context(options)).watch();
  watch(resolve(root, "src"), { recursive: true }, (_event, name) => {
    if (name && /\.(html|svg)$|theme\.js$/.test(name)) copy();
  });
  process.stdout.write("Panel: observando apps/admin/src; recarga /admin para ver cambios.\n");
} else await Promise.all(bundles.map((options) => build(options)));
