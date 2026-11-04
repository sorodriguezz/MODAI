import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import YAML from "yaml";

const exec = promisify(execFile);
const repo = process.cwd();
const tsx = join(repo, "node_modules", "tsx", "dist", "cli.mjs");
const root = mkdtempSync(join(tmpdir(), "modai-acceptance-"));
const env = {
  ...getDefaultEnvironment(),
  MODAI_CONFIG_DIR: join(root, "config"),
  MODAI_SERVER: "",
  MODAI_API_TOKEN: "",
};
after(() => rmSync(root, { recursive: true, force: true }));

async function modai(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(process.execPath, [tsx, join(repo, "packages/cli/src/bin/modai.ts"), ...args], {
    cwd,
    env,
    timeout: 60_000,
  });
  return stdout;
}
async function modaiFails(cwd: string, ...args: string[]): Promise<string> {
  try {
    await modai(cwd, ...args);
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  throw new Error(`Se esperaba un fallo: modai ${args.join(" ")}`);
}

test("un desarrollador externo publica, instala, conecta y ejecuta un paquete de regresión sin tocar el Core", async () => {
  const dev = join(root, "external-developer");
  const registry = join(root, "team-registry");
  mkdirSync(dev, { recursive: true });

  await modai(
    dev,
    "package",
    "scaffold",
    "fake-browser",
    "--name",
    "@acme/fake-browser",
    "--category",
    "testing",
    "--with-tool",
  );
  const browserManifest = YAML.parse(readFileSync(join(dev, "fake-browser/modai.package.yaml"), "utf8"));
  browserManifest.spec.provides = ["browser.automation@1.0.0"];
  browserManifest.spec.contributes.tools[0] = {
    ...browserManifest.spec.contributes.tools[0],
    name: "browser_run_tests",
    implements: "browser.automation",
    description: "Ejecuta las pruebas E2E y devuelve resultados normalizados",
  };
  writeFileSync(join(dev, "fake-browser/modai.package.yaml"), YAML.stringify(browserManifest));
  writeFileSync(
    join(dev, "fake-browser/tools/run.mjs"),
    "let raw='';for await (const c of process.stdin) raw+=c;const input=JSON.parse(raw||'{}');console.log(JSON.stringify({passed:41,failed:1,failures:['checkout > pago con tarjeta'],target:input.target??null}));\n",
  );

  await modai(dev, "package", "scaffold", "regression", "--name", "@acme/regression", "--category", "testing");
  const regressionManifest = YAML.parse(readFileSync(join(dev, "regression/modai.package.yaml"), "utf8"));
  regressionManifest.spec.provides = ["testing.regression.plan@1.0.0", "testing.regression.report@1.0.0"];
  regressionManifest.spec.requires = [{ capability: "browser.automation", version: "^1.0.0" }];
  writeFileSync(join(dev, "regression/modai.package.yaml"), YAML.stringify(regressionManifest));
  writeFileSync(
    join(dev, "regression/knowledge/README.md"),
    "# Regresión visual\n\nUna regresión es una prueba que pasaba en la línea base aprobada y ahora falla.\n",
  );

  assert.match(await modai(dev, "--json", "package", "validate", "fake-browser"), /"score"/);
  assert.match(
    await modai(dev, "package", "validate", "fake-browser"),
    /^Score: \d+\/100/m,
    "sin --json la salida es legible",
  );
  await modai(dev, "package", "publish", "fake-browser", "--registry", registry);
  await modai(dev, "package", "publish", "regression", "--registry", registry);
  assert.match(await modaiFails(dev, "package", "publish", "regression", "--registry", registry), /inmutable/);

  const project = join(root, "shop");
  mkdirSync(project);
  await modai(
    project,
    "init",
    "--registry",
    registry,
    "--adapter",
    "agent-skills,agents-md,mcp",
    "--allow",
    "project.instructions",
  );
  const missing = await modaiFails(project, "add", "@acme/regression");
  assert.match(missing, /browser\.automation/);
  assert.match(missing, /@acme\/fake-browser/, "sugiere el proveedor del contrato");
  assert.equal(
    existsSync(join(project, ".agents/skills/regression")),
    false,
    "un fallo no deja instalaciones a medias",
  );

  await modai(project, "add", "@acme/fake-browser", "@acme/regression");
  const file = YAML.parse(readFileSync(join(project, "modai.yaml"), "utf8"));
  assert.equal(file.dependencies["@acme/regression"], "^0.1.0");
  const lock = YAML.parse(readFileSync(join(project, "modai.lock"), "utf8"));
  assert.equal(lock.capabilities["browser.automation"].provider, "@acme/fake-browser");
  assert.match(lock.packages["@acme/regression"].integrity, /^sha256-[a-f0-9]{64}$/);
  assert.ok(existsSync(join(project, ".agents/skills/regression/SKILL.md")));
  assert.match(readFileSync(join(project, "AGENTS.md"), "utf8"), /browser_run_tests/);
  const capabilities = JSON.parse(await modai(project, "capability", "list", "--json"));
  assert.equal(capabilities.tools[0].authorized, false, "instalar no equivale a autorizar");
  assert.match(await modaiFails(project, "capability", "run", "browser_run_tests"), /modai permissions grant/);

  await modai(project, "permissions", "grant", "@acme/fake-browser", "--yes");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [tsx, join(repo, "packages/cli/src/bin/modai-mcp.ts"), "--project", project],
    cwd: project,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "acceptance-agent", version: "1.0.0" });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(
      tools.includes("browser_run_tests") &&
        tools.includes("modai_search_knowledge") &&
        tools.includes("modai_remember"),
    );
    const run = await client.callTool({ name: "browser_run_tests", arguments: { target: "checkout" } });
    assert.match(JSON.stringify(run.content), /checkout > pago con tarjeta/);
    const knowledge = await client.callTool({
      name: "modai_search_knowledge",
      arguments: { query: "línea base aprobada" },
    });
    assert.match(JSON.stringify(knowledge.content), /@acme\/regression/);
    const skill = await client.readResource({ uri: "modai://skills/regression" });
    assert.match(JSON.stringify(skill.contents), /name: regression/);
    await client.callTool({
      name: "modai_remember",
      arguments: { content: "Las pruebas de pago se ejecutan contra el sandbox del PSP", kind: "decision" },
    });
  } finally {
    await client.close();
  }
  assert.match(await modai(project, "memory", "search", "sandbox pago"), /PSP/);

  const clone = join(root, "shop-clone");
  mkdirSync(clone);
  for (const name of ["modai.yaml", "modai.lock"]) writeFileSync(join(clone, name), readFileSync(join(project, name)));
  await modai(clone, "sync", "--frozen", "--allow", "project.instructions");
  assert.equal(
    readFileSync(join(clone, ".agents/skills/regression/SKILL.md"), "utf8"),
    readFileSync(join(project, ".agents/skills/regression/SKILL.md"), "utf8"),
  );
  assert.match(
    await modaiFails(clone, "capability", "run", "browser_run_tests"),
    /modai permissions grant/,
    "las autorizaciones no viajan con el repositorio",
  );

  await modai(project, "remove", "@acme/regression");
  assert.equal(existsSync(join(project, ".agents/skills/regression")), false);
  assert.doesNotMatch(readFileSync(join(project, "AGENTS.md"), "utf8"), /@acme\/regression/);
});
