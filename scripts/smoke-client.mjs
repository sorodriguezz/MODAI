import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createApp } from "../apps/server/dist/app.js";
import { loadPackageSource } from "../packages/cli/dist/authoring/package-source.js";
import { ApiClient } from "../packages/sdk/dist/index.js";

const exec = promisify(execFile),
  root = mkdtempSync(join(tmpdir(), "modai-standalone-"));
let app, runtime, mcp;
try {
  const { name: packageName, version } = JSON.parse(
    (await import("node:fs")).readFileSync(resolve("packages/cli/package.json"), "utf8"),
  );
  const tarballs = [resolve(`dist/npm/${packageName.replace(/^@/, "").replaceAll("/", "-")}-${version}.tgz`)];
  await exec("npm", ["install", "--prefix", root, "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], {
    timeout: 120000,
  });
  const require = createRequire(join(root, "package.json"));
  for (const dependency of ["fastify", "better-sqlite3", "@modai/contracts", "@modai/sdk"])
    assert.throws(() => require.resolve(dependency), { code: "MODULE_NOT_FOUND" });
  app = await createApp({
    databasePath: join(root, "db.sqlite"),
    artifactDirectory: join(root, "artifacts"),
    apiToken: "standalone-test",
    logger: false,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const server = `http://127.0.0.1:${app.server.address().port}`,
    api = new ApiClient(server, "standalone-test");
  const owner = await api.createOrganization("Smoke");
  for (const namespace of ["@skills", "@agents"])
    await api.createNamespace({ name: namespace, organizationId: owner.id });
  for (const name of ["skill-design-patterns", "agent-backend-reviewer"])
    await api.publish(loadPackageSource(resolve("examples/packages", name)));
  let chatCalls = 0;
  runtime = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags")
      return void res.end(JSON.stringify({ models: [{ name: "fixture-model", digest: "fixture" }] }));
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (chatCalls++ === 0)
      return void res.end(
        JSON.stringify({
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: "modai_recall", arguments: { query: "UUID" } } }],
          },
        }),
      );
    if (chatCalls === 2) assert.match(JSON.stringify(body.messages), /UUID/);
    res.end(JSON.stringify({ message: { role: "assistant", content: "Standalone agent completed" } }));
  });
  await new Promise((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  const runtimeUrl = `http://127.0.0.1:${runtime.address().port}`;
  const shared = await api.createProject({ name: "Shared project" });
  const clientKey = await api.createApiKey("Laptop A", "publisher", { projectIds: [shared.id] });
  const teammateKey = await api.createApiKey("Laptop B", "publisher", { projectIds: [shared.id] });
  const clientToken = clientKey.token;
  const project = join(root, "project");
  mkdirSync(project);
  const env = { ...process.env, MODAI_API_TOKEN: clientToken, MODAI_CONFIG_DIR: join(root, "config") };
  const cli = join(root, "node_modules", packageName, "dist/bin/modai.js");
  const call = async (args, token = clientToken) =>
    (
      await exec(process.execPath, [cli, ...args], {
        cwd: project,
        env: { ...env, MODAI_API_TOKEN: token },
        timeout: 30000,
      })
    ).stdout;
  assert.match(await call(["--help"]), /agent/);
  const login = exec(process.execPath, [cli, "server", "connect", server, "--token-stdin"], {
    cwd: project,
    env: { ...env, MODAI_API_TOKEN: undefined },
    timeout: 30000,
  });
  login.child.stdin.end(clientToken + "\n");
  assert.match((await login).stdout, /Laptop A/);
  await call(["init", "--project", shared.id]);
  assert.equal(JSON.parse(await call(["--json", "server", "whoami"])).label, "Laptop A");
  const status = JSON.parse(await call(["--json", "status"]));
  await call(["memory", "add", "Use UUID for orders", "--kind", "decision"]);
  const teammate = new ApiClient(server, teammateKey.token);
  assert.match(JSON.stringify(await teammate.recall(shared.id, "UUID")), /Use UUID/);
  await teammate.remember({ projectId: shared.id, content: "Use transactions for UUID orders" });
  assert.match(await call(["memory", "search", "transactions"]), /Use transactions/);
  const privateProject = await api.createProject({ name: "Private" });
  await assert.rejects(() => teammate.listMemories(privateProject.id), /PROJECT_FORBIDDEN/);
  await assert.rejects(() => teammate.createApiKey("escalate", "admin"), /FORBIDDEN/);
  await call([
    "agent",
    "activate",
    "@agents/backend-reviewer",
    "--adapter",
    "agents-md",
    "--allow",
    "project.instructions",
  ]);
  assert.match(
    await call(["agent", "run", "Review decisions", "--model", "fixture-model", "--url", runtimeUrl]),
    /Standalone agent completed/,
  );
  const clone = join(root, "project-on-laptop-b");
  cpSync(project, clone, { recursive: true });
  const callB = async (args) =>
    (
      await exec(process.execPath, [cli, ...args], {
        cwd: clone,
        env: {
          ...env,
          MODAI_CONFIG_DIR: join(root, "config-b"),
          MODAI_API_TOKEN: teammateKey.token,
          MODAI_SERVER: server,
        },
        timeout: 30000,
      })
    ).stdout;
  await callB(["server", "connect", server]);
  await callB(["sync"]);
  assert.equal(JSON.parse(await callB(["--json", "server", "whoami"])).label, "Laptop B");
  assert.match(await callB(["memory", "search", "UUID"]), /Use UUID/);
  assert.equal(JSON.parse(await callB(["--json", "status"])).projectId, status.projectId);

  const submitted = JSON.parse(await call(["--json", "agent", "submit", "Remote task"]));
  const key = await api.createApiKey("standalone-worker", "worker", { projectIds: [status.projectId] });
  assert.match(
    await call(
      [
        "--json",
        "agent",
        "worker",
        "--project",
        status.projectId,
        "--model",
        "fixture-model",
        "--url",
        runtimeUrl,
        "--signature-policy",
        "optional",
        "--once",
      ],
      key.token,
    ),
    /true/,
  );
  assert.equal((await api.run(submitted.id)).status, "completed");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "node_modules", packageName, "dist/bin/modai-mcp.js"), "--project", project],
    cwd: project,
    env: {
      ...getDefaultEnvironment(),
      MODAI_API_TOKEN: clientToken,
      MODAI_SERVER: server,
      MODAI_CONFIG_DIR: join(root, "config"),
    },
    stderr: "pipe",
  });
  mcp = new Client({ name: "standalone-smoke", version: "1" });
  await mcp.connect(transport);
  assert.ok((await mcp.listTools()).tools.some((tool) => tool.name === "modai_recall"));
  assert.ok((await mcp.listResources()).resources.some((resource) => resource.uri === "modai://agent/active"));
  assert.match(
    JSON.stringify(await mcp.getPrompt({ name: "modai_agent", arguments: { task: "Review" } })),
    /backend-reviewer/,
  );
  assert.match(JSON.stringify(await mcp.callTool({ name: "modai_recall", arguments: { query: "UUID" } })), /Use UUID/);
  if (process.platform !== "win32") assert.equal(statSync(join(root, "config/client.yaml")).mode & 0o777, 0o600);
  console.log(
    "PASS: one npm tarball; no server/private workspace dependencies; two scoped clients share central memory; isolation; hidden/stdin login; init; activate; local tool loop; remote worker; MCP; private config.",
  );
} finally {
  await mcp?.close();
  if (runtime) {
    runtime.closeAllConnections();
    await new Promise((resolve) => runtime.close(resolve));
  }
  await app?.close();
  rmSync(root, { recursive: true, force: true });
}
