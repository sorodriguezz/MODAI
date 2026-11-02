// Saves or compares regression baselines. Only writes inside the project directory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const project = process.env.MODAI_PROJECT_DIR ?? process.cwd();
const relativePath = normalize(input.baselinePath ?? ".regression/baseline.json");
if (isAbsolute(relativePath) || relativePath.startsWith("..")) throw new Error("baselinePath debe estar dentro del proyecto");
const path = resolve(project, relativePath);
const key = test => `${test.file ?? ""}::${test.title}`;
const current = new Map(input.results.tests.map(test => [key(test), test.status]));

if (input.mode === "save") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ savedAt: new Date().toISOString(), tests: Object.fromEntries(current) }, null, 2) + "\n");
  console.log(JSON.stringify({ saved: relativePath, tests: current.size }));
} else {
  if (!existsSync(path)) { console.log(JSON.stringify({ error: `No existe la línea base ${relativePath}; guarda una con mode=save después de aprobar los resultados` })); process.exit(0); }
  const baseline = new Map(Object.entries(JSON.parse(readFileSync(path, "utf8")).tests));
  const regressions = [], fixed = [], stillFailing = [], added = [], removed = [];
  for (const [name, status] of current) {
    const before = baseline.get(name);
    if (before === undefined) added.push({ test: name, status });
    else if (before === "passed" && status === "failed") regressions.push(name);
    else if (before === "failed" && status === "passed") fixed.push(name);
    else if (before === "failed" && status === "failed") stillFailing.push(name);
  }
  for (const name of baseline.keys()) if (!current.has(name)) removed.push(name);
  console.log(JSON.stringify({ verdict: regressions.length ? "regression" : "ok", regressions, fixed, stillFailing, added, removed }));
}
