import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const MAX_LINES = 250;
const SOURCE = /^(apps|packages)\/[^/]+\/src\/.+\.(ts|js)$/;
const DIRECTIVE = /^\s*\/\/\s*(@ts-|biome-ignore|why:)|^#!/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => SOURCE.test(file));

const problems = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  if (lines.length > MAX_LINES) problems.push(`${file}: ${lines.length} líneas (máximo ${MAX_LINES})`);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const isComment =
      trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("* ") || trimmed === "*/";
    if (isComment && !DIRECTIVE.test(trimmed)) problems.push(`${file}:${index + 1}: comentario`);
  });
}

if (problems.length) {
  process.stderr.write(`${problems.join("\n")}\n\n${problems.length} problemas de arquitectura\n`);
  process.exit(1);
}
process.stdout.write(`${files.length} archivos sin problemas de arquitectura\n`);
