import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  process.stderr.write("Uso: node scripts/release-notes.mjs <versión>\n");
  process.exit(1);
}

const lines = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").split("\n");
const escaped = version.replaceAll(".", "\\.");
const heading = new RegExp(`^## .*(\\(|\\b)v?${escaped}(\\)|\\b)`);
const start = lines.findIndex((line) => heading.test(line));
if (start < 0) process.exit(0);
const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
const section = lines
  .slice(start + 1, end < 0 ? undefined : end)
  .join("\n")
  .trim();
process.stdout.write(section ? `${section}\n` : "");
