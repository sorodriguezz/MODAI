// MODAI tool contract: JSON input on stdin, JSON output on stdout. Runs without a shell; cwd is the project.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");
const project = process.env.MODAI_PROJECT_DIR ?? process.cwd();

const args = ["playwright", "test", "--reporter=json"];
if (input.grep) args.push("--grep", String(input.grep));
if (input.project) args.push("--project", String(input.project));
if (input.config) {
  const config = normalize(String(input.config));
  if (isAbsolute(config) || config.startsWith(".."))
    throw new Error("config debe ser una ruta relativa dentro del proyecto");
  args.push("--config", config);
}
if (!existsSync(join(project, "node_modules", "@playwright", "test"))) {
  console.log(
    JSON.stringify({
      error:
        "Playwright no está instalado en el proyecto. Instálalo con: npm i -D @playwright/test && npx playwright install",
      passed: 0,
      failed: 0,
      skipped: 0,
      tests: [],
    }),
  );
  process.exit(0);
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(npx, args, { cwd: project, env: process.env, shell: false });
let stdout = "",
  stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.on("close", (code) => {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    console.log(JSON.stringify({ error: `Playwright terminó con código ${code}`, stderr: stderr.slice(0, 4000) }));
    return;
  }
  const tests = [];
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        const result = test.results?.at(-1) ?? {};
        const status =
          test.status === "expected"
            ? "passed"
            : test.status === "skipped"
              ? "skipped"
              : test.status === "flaky"
                ? "flaky"
                : "failed";
        tests.push({
          title: [suite.title, spec.title].filter(Boolean).join(" > "),
          file: spec.file ?? file,
          status,
          durationMs: result.duration ?? 0,
          ...(status === "failed" ? { error: String(result.error?.message ?? "").slice(0, 2000) } : {}),
        });
      }
    for (const child of suite.suites ?? []) walk(child, suite.file ?? file);
  };
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  const count = (status) => tests.filter((test) => test.status === status).length;
  console.log(
    JSON.stringify({
      passed: count("passed"),
      failed: count("failed"),
      flaky: count("flaky"),
      skipped: count("skipped"),
      tests,
    }),
  );
});
