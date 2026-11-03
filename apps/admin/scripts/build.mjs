import { copyFileSync, mkdirSync, watch } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
mkdirSync(resolve(root, "dist"), { recursive: true });
const copy = () => {
  for (const file of ["index.html", "styles.css", "theme.js", "favicon.svg"])
    copyFileSync(resolve(root, "src", file), resolve(root, "dist", file));
};
copy();
const options = {
  entryPoints: [resolve(root, "src/main.js")],
  outfile: resolve(root, "dist/main.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: !process.argv.includes("--watch"),
  legalComments: "none",
  logLevel: "info",
};
if (process.argv.includes("--watch")) {
  const bundler = await context(options);
  await bundler.watch();
  watch(resolve(root, "src"), { recursive: true }, (_event, name) => {
    if (name && /\.(html|css|svg)$|^theme\.js$/.test(name)) copy();
  });
  console.log("Panel: observando apps/admin/src; recarga /admin para ver cambios.");
} else await build(options);
