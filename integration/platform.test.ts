import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { publicKeyFingerprint, sha256, signaturePayload } from "@modai/contracts/security";
import type { PackageManifest, PublishPackageInput } from "@modai/contracts/types";
import { createProjectFile, HttpRegistry, loadV1Project, saveProjectFile, syncWorkspace } from "@modai/core";
import { ApiClient } from "@modai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { type AppOptions, createApp } from "../apps/server/src/app.js";
import { ApiKeysService } from "../apps/server/src/modules/auth/api-keys.service.js";
import { AuthorizationService } from "../apps/server/src/modules/auth/authorization.service.js";
import { RunsService } from "../apps/server/src/modules/runs/runs.service.js";
import { openTestDatabase, testDatabase } from "../apps/server/test/support/test-database.js";
import { activateAgent, deactivateAgent, loadActivation } from "../packages/cli/src/agents/activation.js";
import { CapabilityHost } from "../packages/cli/src/agents/capabilities.js";
import { executeAgent } from "../packages/cli/src/agents/runtime.js";
import { workOnce } from "../packages/cli/src/agents/worker.js";
import { loadPackageSource } from "../packages/cli/src/authoring/package-source.js";
import { verifyPackage } from "../packages/cli/src/services/trust.js";

const approvalDirectory = mkdtempSync(join(tmpdir(), "modai-test-approvals-"));
process.env.MODAI_CONFIG_DIR = approvalDirectory;
after(() => rmSync(approvalDirectory, { recursive: true, force: true }));
const admin = "platform-test-secret";
const headers = { authorization: `Bearer ${admin}` };
function input(
  name: string,
  spec: Record<string, unknown> = {},
  files: Record<string, string> = {},
): PublishPackageInput {
  return {
    manifest: {
      apiVersion: "modai.dev/v1",
      kind: "Package",
      metadata: { name, version: "1.0.0", description: "Capacidad de prueba verificable" },
      spec: { category: "test", ...spec },
    } as PackageManifest,
    files: Object.entries(files).map(([path, content]) => ({
      path,
      content: Buffer.from(content).toString("base64"),
      sha256: sha256(content),
    })),
  };
}
async function fixture(overrides: Partial<AppOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), "modai-platform-"));
  const app = await createApp({
    ...(await testDatabase(join(root, "db.sqlite"))),
    artifactDirectory: join(root, "artifacts"),
    apiToken: admin,
    logger: false,
    ...overrides,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const server = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
    api = new ApiClient(server, admin);
  return {
    root,
    app,
    api,
    server,
    close: async () => {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
async function publishExamples(api: ApiClient) {
  for (const name of ["skill-design-patterns", "agent-backend-reviewer"])
    await api.publish(loadPackageSource(join(process.cwd(), "examples/packages", name)));
}
async function localProject(root: string, server: string, id: string) {
  const path = join(root, "project");
  mkdirSync(path);
  saveProjectFile(
    path,
    createProjectFile(id, {
      registries: [{ name: "central", url: server }],
      adapters: ["agent-skills"],
      context: { memory: "remote", server, projectId: id },
    }),
  );
  return path;
}
function installV1(server: string, project: string, dependencies: Record<string, string>, grants: string[] = []) {
  saveProjectFile(
    project,
    createProjectFile("install", {
      registries: [{ name: "central", url: server }],
      adapters: ["agent-skills"],
      dependencies,
    }),
  );
  return syncWorkspace(loadV1Project(project), {
    registries: [new HttpRegistry(server, admin)],
    grants,
    trust: { policy: "optional", trustedPublishers: [] },
  });
}
interface ChatRequest {
  tools: Array<{ function: { name: string } }>;
  messages: unknown[];
}

async function fakeOllama(chat: (body: ChatRequest, index: number) => unknown) {
  let count = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags")
      return void res.end(JSON.stringify({ models: [{ name: "test-model", digest: "test-digest" }] }));
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/api/chat") return void res.end(JSON.stringify(chat(JSON.parse(body), count++)));
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("rechaza arranque sin credenciales y no reactiva administración al revocar la última clave", async () => {
  const root = mkdtempSync(join(tmpdir(), "modai-auth-"));
  try {
    const opts = {
      ...(await testDatabase(join(root, "db.sqlite"))),
      artifactDirectory: join(root, "artifacts"),
      logger: false,
    };
    await assert.rejects(() => createApp(opts), /Configura MODAI_API_TOKEN/);
    const db = await openTestDatabase(join(root, "db.sqlite"));
    const key = await new ApiKeysService(db, new AuthorizationService(db)).createKey("admin", "admin");
    await db.close();
    const app = await createApp(opts);
    try {
      const remote = await app.inject({ method: "GET", url: "/api/v1/session", remoteAddress: "192.0.2.4" });
      assert.equal(remote.statusCode, 401);
      assert.equal(
        (
          await app.inject({
            method: "DELETE",
            url: `/api/v1/admin/api-keys/${key.id}`,
            headers: { authorization: `Bearer ${key.token}` },
          })
        ).statusCode,
        204,
      );
      assert.equal((await app.inject({ method: "GET", url: "/api/v1/session" })).statusCode, 401);
    } finally {
      await app.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("autoriza memoria por proyecto y publicación por namespace; worker no es publisher", async () => {
  const f = await fixture();
  try {
    await f.api.createProject({ id: "a", name: "A" });
    await f.api.createProject({ id: "b", name: "B" });
    const memory = (await f.api.remember({ projectId: "b", content: "decisión privada" })) as { id: string };
    const create = async (role: string, projectIds: string[], packageScopes: string[] = []) =>
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/admin/api-keys",
          headers,
          payload: { label: role, role, projectIds, packageScopes },
        })
      ).json().key.token as string;
    const reader = await create("reader", ["a"]),
      publisher = await create("publisher", ["a"], ["@allowed"]),
      worker = await create("worker", ["a"]);
    for (const [method, url, payload] of [
      ["GET", "/api/v1/memories?projectId=b", undefined],
      ["POST", "/api/v1/memories/search", { projectId: "b", query: "decisión" }],
      ["PATCH", `/api/v1/memories/${memory.id}`, { content: "changed" }],
      ["DELETE", `/api/v1/memories/${memory.id}`, undefined],
    ] as const) {
      const r = await f.app.inject({
        method,
        url,
        payload,
        headers: { authorization: `Bearer ${method === "GET" || url.endsWith("search") ? reader : publisher}` },
      });
      assert.equal(r.statusCode, 403, r.body);
    }
    assert.equal((await new ApiClient(f.server, reader).listMemories("a")).length, 0);
    await assert.rejects(() => new ApiClient(f.server, publisher).publish(input("@other/tool")), /PACKAGE_FORBIDDEN/);
    await new ApiClient(f.server, publisher).publish(input("@allowed/tool"));
    await assert.rejects(() => new ApiClient(f.server, worker).publish(input("@allowed/worker")), /FORBIDDEN/);
    const owned = await new ApiClient(f.server, publisher).createProject({ name: "owned" });
    await new ApiClient(f.server, publisher).remember({ projectId: owned.id, content: "own memory" });
    await assert.rejects(() => new ApiClient(f.server, reader).listMemories(owned.id), /PROJECT_FORBIDDEN/);
  } finally {
    await f.close();
  }
});

test("separa memoria de proyecto y sesión; compartir organización exige permiso explícito", async () => {
  const f = await fixture();
  try {
    const org = await f.api.createOrganization("equipo");
    for (const id of ["a", "b"]) await f.api.createProject({ id, name: id, organizationId: org.id });
    await f.api.remember({ projectId: "a", content: "convención compartida", scope: "organization" });
    await f.api.remember({ projectId: "b", content: "convención de sesión", scope: "session", sessionId: "s1" });
    await f.api.remember({ projectId: "b", content: "convención privada", scope: "project" });
    assert.equal((await f.api.recall("b", "convención")).length, 1);
    assert.equal((await f.api.recall("b", "convención", { sessionId: "s1" })).length, 2);
    assert.equal((await f.api.recall("b", "convención", { includeOrganization: true })).length, 2);
    const token = (
      await f.app.inject({
        method: "POST",
        url: "/api/v1/admin/api-keys",
        headers,
        payload: { label: "b", role: "reader", projectIds: ["b"] },
      })
    ).json().key.token;
    await assert.rejects(
      () => new ApiClient(f.server, token).recall("b", "convención", { includeOrganization: true }),
      /ORGANIZATION_FORBIDDEN/,
    );
    const memory = (await f.api.listMemories("b"))[0] as { id: string };
    await assert.rejects(() => f.api.updateMemory(memory.id, { scope: "organization" }), /IMMUTABLE_SCOPE/);
  } finally {
    await f.close();
  }
});

test("bloquea hooks, rutas reservadas, permisos sin conceder y escapes mediante symlinks", async () => {
  const f = await fixture();
  try {
    for (const target of [
      ".git/hooks/pre-commit",
      ".GIT/config",
      ".github/workflows/pwn.yml",
      "package.json",
      ".env",
      ".agents/skills/a/../../escape",
      "C:\\escape",
      ".modai/manifest.yaml",
    ]) {
      await assert.rejects(
        () =>
          f.api.publish(
            input("@paths/test", { contributes: { files: [{ source: "x", target }] } }, { x: "safe marker" }),
          ),
        /UNSAFE_/,
      );
    }
    const p = await f.api.publish(
      input(
        "@paths/linked",
        { contributes: { files: [{ source: "x", target: ".agents/skills/linked/file.txt" }] } },
        { x: "safe marker" },
      ),
    );
    const project = join(f.root, "install"),
      outside = join(f.root, "outside");
    mkdirSync(project);
    mkdirSync(outside);
    mkdirSync(join(project, ".agents"));
    symlinkSync(outside, join(project, ".agents/skills"));
    await assert.rejects(() => installV1(f.server, project, { [p.name]: "*" }), /simbólic|symlink/i);
    assert.equal(existsSync(join(outside, "linked/file.txt")), false);
    const executable = input(
      "@paths/exec",
      {
        permissions: ["process.execute"],
        contributes: { files: [{ source: "x", target: ".modai/packages/script.sh", executable: true }] },
      },
      { x: "marker" },
    );
    await f.api.publish(executable);
    rmSync(join(project, ".agents/skills"));
    await assert.rejects(() => installV1(f.server, project, { "@paths/exec": "*" }), /conceder process\.execute/);
  } finally {
    await f.close();
  }
});

test("verifica firmas en servidor y cliente, exige publicador autorizado y detecta manipulación", async () => {
  const f = await fixture({ signaturePolicy: "trusted" });
  try {
    const pair = generateKeyPairSync("ed25519"),
      publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const unsigned = input("@signed/tool", {}, { x: "original" });
    await assert.rejects(() => f.api.publish(unsigned), /SIGNATURE_REQUIRED/);
    const signed = {
      ...unsigned,
      signature: {
        algorithm: "ed25519" as const,
        publicKey,
        signature: sign(null, signaturePayload(unsigned.manifest, unsigned.files), pair.privateKey).toString("base64"),
      },
    };
    await assert.rejects(() => f.api.publish(signed), /UNTRUSTED_PUBLISHER/);
    const fingerprint = await f.api.registerPublisher(publicKey, "team", true);
    const record = await f.api.publish(signed),
      artifact = await f.api.artifact(record.artifactId);
    assert.throws(() => verifyPackage(record, artifact, "trusted", []), /no autorizado/);
    verifyPackage(record, artifact, "trusted", [fingerprint]);
    assert.throws(
      () =>
        verifyPackage({ ...record, manifest: { ...record.manifest, description: "tampered" } }, artifact, "trusted", [
          fingerprint,
        ]),
      /Firma inválida/,
    );
    const changed = {
      files: artifact.files.map((file) => ({
        ...file,
        content: Buffer.from("changed").toString("base64"),
        sha256: sha256("changed"),
      })),
    };
    assert.throws(
      () => verifyPackage(record, { ...changed, sha256: sha256(JSON.stringify(changed)) }, "trusted", [fingerprint]),
      /Firma inválida/,
    );
  } finally {
    await f.close();
  }
});

test("compone y fija agentes con skills y herramientas; activación conserva archivos del usuario", async () => {
  const f = await fixture();
  try {
    await publishExamples(f.api);
    await f.api.createProject({ id: "p", name: "p" });
    const project = await localProject(f.root, f.server, "p");
    const activation = await activateAgent(f.api, project, f.server, "@agents/backend-reviewer", "*", {
      adapter: "agents-md",
      grants: ["project.instructions"],
    });
    assert.equal(activation.bundle.agent.version, "1.0.0");
    assert.equal(activation.bundle.capabilities.length, 2);
    assert.ok(activation.bundle.instructions.some((i) => i.packageName === "@skills/design-patterns"));
    assert.match(readFileSync(join(project, "AGENTS.md"), "utf8"), /\.modai\/agent.md/);
    assert.ok(existsSync(join(project, ".agents/skills/design-patterns/SKILL.md")));
    assert.equal(loadActivation(project).bundle.digest, activation.bundle.digest);
    const old = loadPackageSource(join(process.cwd(), "examples/packages/agent-backend-reviewer"));
    old.manifest.metadata.version = "2.0.0";
    await f.api.publish(old);
    assert.equal(loadActivation(project).bundle.agent.version, "1.0.0");
    const upgraded = await activateAgent(f.api, project, f.server, "@agents/backend-reviewer", "2.0.0", {
      adapter: "agents-md",
    });
    assert.equal(upgraded.bundle.agent.version, "2.0.0");
    writeFileSync(join(project, ".modai/agent.md"), "user changes");
    await assert.rejects(
      () => activateAgent(f.api, project, f.server, "@agents/backend-reviewer", "1.0.0"),
      /cambios del usuario/,
    );
    const deactivated = deactivateAgent(project);
    assert.ok(deactivated.preserved.includes(".modai/agent.md"));
    assert.equal(existsSync(join(project, ".modai/activation.json")), false);
    assert.doesNotMatch(readFileSync(join(project, "AGENTS.md"), "utf8"), /modai:agent:start/);
  } finally {
    await f.close();
  }
});

test("rechaza herramientas ausentes, políticas de memoria incompatibles y colisiones de servidores MCP", async () => {
  const f = await fixture();
  try {
    const agent = (name: string, capabilities: string[], write = false) => ({
      contributes: {
        agents: [{ name, instructions: "Revisa", skills: [], capabilities, memory: { read: ["project"], write } }],
      },
    });
    await assert.rejects(
      () => f.api.publish(input("@agents/missing", agent("missing", ["missing"]))),
      /AGENT_CAPABILITY/,
    );
    await assert.rejects(
      () => f.api.publish(input("@agents/write", agent("write", ["modai_remember"]))),
      /MEMORY_POLICY/,
    );
    await f.api.publish(input("@agents/writer", agent("writer", ["modai_remember"], true)));
    await f.api.createProject({ id: "p", name: "p" });
    assert.deepEqual(
      (await f.api.composeAgent("p", "@agents/writer")).capabilities.map((c) => c.name),
      ["modai_remember"],
    );
    await f.api.publish(input("@lib/empty"));
    await f.api.publish(input("@agents/lost", { dependencies: { "@lib/empty": "*" }, ...agent("lost", ["missing"]) }));
    await assert.rejects(() => f.api.composeAgent("p", "@agents/lost"), /CAPABILITY_NOT_FOUND/);
    const server = (name: string) => ({
      permissions: ["mcp.connect"],
      contributes: { mcpServers: [{ name: "echo", description: "Echo", command: "node", args: ["-e", "0"] }] },
    });
    await f.api.publish(input("@mcp/one", server("one")));
    await f.api.publish(input("@mcp/two", server("two")));
    await f.api.publish(
      input("@agents/clash", { dependencies: { "@mcp/one": "*", "@mcp/two": "*" }, ...agent("clash", ["echo"]) }),
    );
    await assert.rejects(() => f.api.composeAgent("p", "@agents/clash"), /CAPABILITY_COLLISION/);
  } finally {
    await f.close();
  }
});

test("ejecuta ciclo de herramientas con Ollama y el contexto autorizado del proyecto", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof fakeOllama>> | undefined;
  try {
    await publishExamples(f.api);
    await f.api.createProject({ id: "p", name: "p" });
    await f.api.remember({ projectId: "p", content: "Usamos UUID" });
    runtime = await fakeOllama((body, index) => {
      if (index === 0) {
        assert.ok(body.tools.some((tool) => tool.function.name === "modai_recall"));
        return {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: "modai_recall", arguments: { query: "UUID" } } }],
          },
        };
      }
      assert.match(JSON.stringify(body.messages), /Usamos UUID/);
      return { message: { role: "assistant", content: "Revisión con memoria de UUID" } };
    });
    const bundle = await f.api.composeAgent("p", "@agents/backend-reviewer");
    const answer = await executeAgent(f.api, bundle, "Revisa decisiones", {
      cwd: f.root,
      model: "test-model",
      url: runtime.url,
    });
    assert.match(answer, /UUID/);
    const host = new CapabilityHost(f.api, bundle, { cwd: f.root });
    await host.start();
    try {
      await assert.rejects(() => host.call("modai_remember", { content: "forbidden" }), /no habilitada/);
    } finally {
      await host.close();
    }
  } finally {
    await runtime?.close();
    await f.close();
  }
});

test("worker procesa cola, congela versiones y rechaza finalizar con un lease viejo", async () => {
  const f = await fixture();
  const runtime = await fakeOllama(() => ({ message: { role: "assistant", content: "Trabajo completado" } }));
  try {
    await publishExamples(f.api);
    await f.api.createProject({ id: "p", name: "p" });
    const token = (
      await f.app.inject({
        method: "POST",
        url: "/api/v1/admin/api-keys",
        headers,
        payload: { label: "worker", role: "worker", projectIds: ["p"] },
      })
    ).json().key.token;
    const worker = new ApiClient(f.server, token);
    const run = await f.api.submitRun({
      projectId: "p",
      name: "@agents/backend-reviewer",
      task: "Review",
      idempotencyKey: "same",
    });
    assert.equal(
      (
        await f.api.submitRun({
          projectId: "p",
          name: "@agents/backend-reviewer",
          task: "Review",
          idempotencyKey: "same",
        })
      ).id,
      run.id,
    );
    assert.equal(
      await workOnce(worker, "p", { cwd: f.root, model: "test-model", url: runtime.url, signaturePolicy: "optional" }),
      true,
    );
    assert.equal((await f.api.run(run.id)).result, "Trabajo completado");
    assert.equal(await workOnce(worker, "p", { cwd: f.root, model: "test-model", url: runtime.url }), false);
    const next = await f.api.submitRun({ projectId: "p", name: "@agents/backend-reviewer", task: "Another" });
    const first = await worker.claimRun("p");
    assert.equal(first!.run.id, next.id);
    const db = await openTestDatabase(join(f.root, "db.sqlite"));
    await db.db.updateTable("runs").set({ lease_expires_at: "2000-01-01" }).where("id", "=", next.id).execute();
    await db.close();
    const second = await worker.claimRun("p");
    assert.equal(second!.run.id, next.id);
    assert.notEqual(second!.leaseToken, first!.leaseToken);
    await assert.rejects(() => worker.finishRun(next.id, first!.leaseToken, { result: "stale" }), /LEASE_LOST/);
    await f.api.cancelRun(next.id);
    await assert.rejects(() => worker.heartbeat(next.id, second!.leaseToken), /LEASE_LOST/);
  } finally {
    await runtime.close();
    await f.close();
  }
});

test("MCP descubre herramientas de un proceso aprobado y aplica la política del agente activo", async () => {
  const f = await fixture();
  let client: Client | undefined;
  try {
    const script = join(f.root, "echo.mjs");
    writeFileSync(
      script,
      `import {Server} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};\nimport {StdioServerTransport} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};\nimport {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};\nconst s=new Server({name:'echo',version:'1'},{capabilities:{tools:{}}});s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'ping',description:'Echo',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));s.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:'pong'}]}));await s.connect(new StdioServerTransport());`,
    );
    await f.api.publish(
      input("@mcp/echo", {
        permissions: ["mcp.connect"],
        contributes: {
          mcpServers: [
            { name: "echo", description: "Echo fixture", command: process.execPath, args: [script], envKeys: [] },
          ],
        },
      }),
    );
    await f.api.publish(
      input("@agents/echo", {
        dependencies: { "@mcp/echo": "*" },
        contributes: {
          agents: [
            {
              name: "echo",
              instructions: "Usa echo",
              skills: [],
              capabilities: ["echo"],
              memory: { read: [], write: false },
            },
          ],
        },
      }),
    );
    await f.api.createProject({ id: "p", name: "p" });
    const project = await localProject(f.root, f.server, "p");
    await assert.rejects(
      () => activateAgent(f.api, project, f.server, "@agents/echo", "*", { grants: ["mcp.connect"] }),
      /allow-mcp/,
    );
    await activateAgent(f.api, project, f.server, "@agents/echo", "*", {
      grants: ["mcp.connect"],
      allowedMcp: ["echo"],
    });
    const copied = join(f.root, "copied-project");
    cpSync(project, copied, { recursive: true });
    assert.deepEqual(loadActivation(copied).allowedMcp, []);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "packages/cli/dist/bin/modai-mcp.js"), "--project", project],
      cwd: project,
      env: {
        ...getDefaultEnvironment(),
        MODAI_SERVER: f.server,
        MODAI_API_TOKEN: admin,
        MODAI_CONFIG_DIR: approvalDirectory,
      },
      stderr: "pipe",
    });
    client = new Client({ name: "test", version: "1" });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "echo__ping"));
    assert.ok(!tools.tools.some((t) => t.name === "modai_remember"));
    const result = await client.callTool({ name: "echo__ping", arguments: {} });
    assert.match(JSON.stringify(result), /pong/);
  } finally {
    await client?.close();
    await f.close();
  }
});

test("limita intentos, protege framing y aplica cuota de artefactos", async () => {
  const f = await fixture({ maxArtifactStorageBytes: 100 });
  try {
    const html = await f.app.inject({ method: "GET", url: "/admin" });
    assert.equal(html.headers["x-frame-options"], "DENY");
    assert.match(String(html.headers["content-security-policy"]), /frame-ancestors 'none'/);
    await assert.rejects(() => f.api.publish(input("@quota/test", {}, { x: "x".repeat(200) })), /STORAGE_QUOTA/);
  } finally {
    await f.close();
  }
  const limited = await fixture({ rateLimitMax: 2 });
  try {
    for (let i = 0; i < 2; i++)
      assert.equal((await limited.app.inject({ method: "GET", url: "/health" })).statusCode, 200);
    assert.equal((await limited.app.inject({ method: "GET", url: "/health" })).statusCode, 429);
  } finally {
    await limited.close();
  }
});

test("restaura proyectos, organización, memorias y tareas sin credenciales ni leases activos", async () => {
  const source = await fixture(),
    target = await fixture();
  try {
    await publishExamples(source.api);
    const org = await source.api.createOrganization("equipo");
    await source.api.createProject({ id: "restore", name: "Restore", organizationId: org.id });
    await source.api.remember({ projectId: "restore", content: "decisión compartida", scope: "organization" });
    await source.api.remember({
      projectId: "restore",
      content: "sesión de prueba",
      scope: "session",
      sessionId: "session",
    });
    const run = await source.api.submitRun({
      projectId: "restore",
      name: "@agents/backend-reviewer",
      task: "Restore job",
    });
    await source.api.claimRun("restore");
    const snapshot = (await source.api.exportBackup()) as Record<string, unknown>;
    assert.ok(!JSON.stringify(snapshot).includes(admin));
    assert.equal(snapshot.apiKeys, undefined);
    await target.api.importBackup(snapshot);
    assert.equal((await target.api.projects())[0].id, "restore");
    assert.equal((await target.api.recall("restore", "decisión", { includeOrganization: true })).length, 1);
    assert.equal((await target.api.recall("restore", "sesión", { sessionId: "session" })).length, 1);
    const restored = await target.api.run(run.id);
    assert.equal(restored.status, "queued");
    assert.equal(restored.leaseExpiresAt, undefined);
  } finally {
    await source.close();
    await target.close();
  }
});

test("la búsqueda vectorial limita candidatos y mantiene disponible la API después del rechazo", async () => {
  const f = await fixture();
  try {
    const db = await openTestDatabase(join(f.root, "db.sqlite"));
    const blob = Buffer.alloc(4);
    blob.writeFloatLE(1);
    const ids = Array.from({ length: 2001 }, (_, i) => String(i));
    await db.transaction(async ({ db: trx }) => {
      for (let start = 0; start < ids.length; start += 100) {
        const chunk = ids.slice(start, start + 100);
        const at = "2026-01-01";
        await trx
          .insertInto("knowledge_documents")
          .values(
            chunk.map((id) => ({
              id,
              title: "doc",
              content: "content",
              tags_json: "[]",
              created_at: at,
              updated_at: at,
            })),
          )
          .execute();
        await trx
          .insertInto("knowledge_vectors")
          .values(
            chunk.map((id) => ({
              document_id: id,
              model: "large",
              dimensions: 1,
              embedding_blob: blob,
              updated_at: at,
            })),
          )
          .execute();
      }
    });
    await db.close();
    await assert.rejects(() => f.api.vectorSearch("large", [1]), /VECTOR_CANDIDATE_LIMIT/);
    assert.equal((await f.api.health()).status, "ok");
    const empty = await f.api.vectorSearch("large", [1], []);
    assert.deepEqual(empty, []);
  } finally {
    await f.close();
  }
});

test("la cola abandona una tarea después de tres workers vencidos", async () => {
  const f = await fixture();
  try {
    await publishExamples(f.api);
    await f.api.createProject({ id: "p", name: "p" });
    const run = await f.api.submitRun({ projectId: "p", name: "@agents/backend-reviewer", task: "retry" });
    const db = await openTestDatabase(join(f.root, "db.sqlite")),
      runs = new RunsService(db);
    for (let i = 0; i < 3; i++) {
      assert.ok(await runs.claim("p", "worker"));
      await db.db.updateTable("runs").set({ lease_expires_at: "2000-01-01" }).where("id", "=", run.id).execute();
    }
    assert.equal(await runs.claim("p", "worker"), undefined);
    assert.equal((await runs.get(run.id)).status, "failed");
    await db.close();
  } finally {
    await f.close();
  }
});

test("los servidores MCP de un agente usan ${packageDir} solo desde un store que coincide con modai.lock", async () => {
  const f = await fixture();
  try {
    const sdk = (path: string) => JSON.stringify(import.meta.resolve(`@modelcontextprotocol/sdk/${path}`));
    const script = `import {Server} from ${sdk("server/index.js")};\nimport {StdioServerTransport} from ${sdk("server/stdio.js")};\nimport {ListToolsRequestSchema,CallToolRequestSchema} from ${sdk("types.js")};\nconst s=new Server({name:'pkg',version:'1'},{capabilities:{tools:{}}});s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'ping',description:'Ping',inputSchema:{type:'object',properties:{},additionalProperties:false}}]}));s.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:'from-store'}]}));await s.connect(new StdioServerTransport());`;
    await f.api.publish(
      input(
        "@mcp/packaged",
        {
          permissions: ["mcp.connect"],
          contributes: {
            mcpServers: [
              {
                name: "packaged",
                description: "Servidor empaquetado",
                command: "node",
                args: ["${packageDir}/server.mjs"],
              },
            ],
          },
        },
        { "server.mjs": script },
      ),
    );
    await f.api.publish(
      input("@agents/packaged", {
        dependencies: { "@mcp/packaged": "*" },
        contributes: {
          agents: [
            {
              name: "packaged",
              instructions: "Usa el servidor",
              skills: [],
              capabilities: ["packaged"],
              memory: { read: [], write: false },
            },
          ],
        },
      }),
    );
    await f.api.createProject({ id: "p", name: "p" });
    const project = await localProject(f.root, f.server, "p");
    const activation = await activateAgent(f.api, project, f.server, "@agents/packaged", "*", {
      grants: ["mcp.connect"],
      allowedMcp: ["packaged"],
    });
    const options = { cwd: project, allowedMcp: ["packaged"] };
    const host = new CapabilityHost(f.api, activation.bundle, options);
    await host.start();
    try {
      assert.deepEqual(
        host.list().map((tool) => tool.name),
        ["packaged__ping"],
      );
      assert.match(JSON.stringify(await host.call("packaged__ping", {})), /from-store/);
    } finally {
      await host.close();
    }
    await assert.rejects(() => new CapabilityHost(f.api, activation.bundle, { cwd: project }).start(), /no autorizado/);
    writeFileSync(join(project, ".modai/store/@mcp/packaged/files/server.mjs"), "process.exit(0)");
    await assert.rejects(() => new CapabilityHost(f.api, activation.bundle, options).start(), /contenido cambió/);
  } finally {
    await f.close();
  }
});

test("sirve el panel compilado con scripts externos y anuncia la dirección central sin exponer archivos", async () => {
  const f = await fixture({ publicUrl: "https://modai.example.test/" });
  try {
    assert.equal((await f.api.health()).publicUrl, "https://modai.example.test");
    for (const route of ["/admin", "/admin/"]) {
      const page = await f.app.inject({ method: "GET", url: route });
      assert.equal(page.statusCode, 200);
      assert.match(String(page.headers["content-type"]), /text\/html/);
      assert.match(String(page.headers["content-security-policy"]), /script-src 'self';/);
      assert.match(String(page.headers["content-security-policy"]), /script-src-attr 'none'/);
      assert.doesNotMatch(page.body, /\son(?:click|change|input|submit)=/);
    }
    for (const name of ["main.js", "theme.js", "styles.css"]) {
      const asset = await f.app.inject({ method: "GET", url: `/admin/assets/${name}` });
      assert.equal(asset.statusCode, 200);
      assert.ok(asset.body.length > 0);
      assert.equal(asset.headers["cache-control"], "no-cache");
    }
    for (const name of ["package.json", "index.html", "..%2f..%2fpackage.json", "%2e%2e%2f.env"])
      assert.equal((await f.app.inject({ method: "GET", url: `/admin/assets/${name}` })).statusCode, 404);
  } finally {
    await f.close();
  }
});
