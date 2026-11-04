import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApiClient } from "@modai/sdk";
import { createApp } from "../apps/server/src/app.js";
import {
  chunkText,
  indexKnowledge,
  type LocalModelsConfig,
  semanticSearch,
  sourceHash,
  vectorSpace,
} from "../packages/cli/src/client/embeddings.js";
import { type Hardware, recommendModels } from "../packages/cli/src/client/hardware.js";
import { LocalOllama, localRuntimeUrl } from "../packages/cli/src/client/ollama.js";
import { testDatabase } from "./support/test-database.js";

function hardware(patch: Partial<Hardware> = {}): Hardware {
  return {
    platform: "win32",
    architecture: "x64",
    processArchitecture: "x64",
    cpu: "test",
    threads: 4,
    ramGiB: 8,
    availableRamGiB: 5,
    gpus: [],
    appleSilicon: false,
    notes: [],
    ...patch,
  };
}
test("selecciona modelos conservadores en CPU, Intel Mac, ARM, Apple Silicon y GPUs", () => {
  for (const h of [
    hardware(),
    hardware({ platform: "darwin" }),
    hardware({ architecture: "arm64" }),
    hardware({ gpus: [{ name: "AMD Radeon" }] }),
    hardware({ gpus: [{ name: "Intel Arc" }] }),
  ]) {
    const plan = recommendModels(h);
    assert.equal(plan.embeddingModel, "embeddinggemma-2:270m");
    assert.equal(plan.batchSize, 1);
  }
  assert.equal(recommendModels(hardware({ ramGiB: 4, availableRamGiB: 2 })).canEmbed, false);
  assert.equal(
    recommendModels(hardware({ platform: "darwin", appleSilicon: true, ramGiB: 16, availableRamGiB: 10 }))
      .embeddingModel,
    "qwen3-embedding:0.6b",
  );
  const powerful = hardware({
    ramGiB: 32,
    availableRamGiB: 24,
    gpus: [{ name: "NVIDIA", freeGiB: 16, memoryGiB: 24 }],
  });
  assert.equal(recommendModels(powerful, "quality").embeddingModel, "qwen3-embedding:4b");
  assert.equal(recommendModels(powerful).chatModel, "qwen3.5:9b");
  assert.equal(
    recommendModels(hardware({ ramGiB: 64, availableRamGiB: 2, gpus: [{ name: "NVIDIA", freeGiB: 1 }] }), "quality")
      .canEmbed,
    false,
  );
});

test("limita el runtime a loopback y conserva todos los caracteres al fragmentar", () => {
  for (const url of [
    "https://api.ollama.com",
    "http://192.168.1.5:11434",
    "http://localhost.evil.test",
    "http://user:pass@localhost",
    "http://localhost/path",
    "http://localhost/?token=secret",
  ])
    assert.throws(() => localRuntimeUrl(url));
  assert.equal(localRuntimeUrl("http://[::1]:11434"), "http://[::1]:11434");
  const text = "á😀".repeat(2200),
    chunks = chunkText(text, 1200, 0);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((c) => Array.from(c).length <= 1200));
  assert.throws(() => chunkText("abc", 10, 10));
});

test("cliente calcula embeddings con runtime local y servidor solo almacena vectores", async () => {
  const root = mkdtempSync(join(tmpdir(), "modai-client-"));
  const app = await createApp({
    ...(await testDatabase(join(root, "db.sqlite"))),
    artifactDirectory: join(root, "artifacts"),
    apiToken: "test-secret",
    logger: false,
  });
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let digest = "digest-one",
    failBatch = true;
  const runtime = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: req.url ?? "", body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/tags")
      return void res.end(JSON.stringify({ models: [{ name: "embeddinggemma-2:270m", digest }] }));
    if (req.url === "/api/embed") {
      if (failBatch && body.input.length > 1) {
        failBatch = false;
        res.statusCode = 500;
        return void res.end(JSON.stringify({ error: "OOM de prueba" }));
      }
      assert.equal(body.truncate, false);
      return void res.end(JSON.stringify({ embeddings: body.input.map(() => [1, 0, 0]) }));
    }
    if (req.url === "/api/pull") return void res.end('{"status":"success"}\n');
    res.statusCode = 404;
    res.end("{}");
  });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
    const api = new ApiClient(`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, "test-secret");
    const config: LocalModelsConfig = {
      schemaVersion: 1,
      url: `http://127.0.0.1:${(runtime.address() as AddressInfo).port}`,
      embeddingModel: "embeddinggemma-2:270m",
      digest,
      batchSize: 4,
      chatModel: "qwen3.5:0.8b",
    };
    await new LocalOllama(config.url).pull(config.embeddingModel);
    await assert.rejects(() => new LocalOllama(config.url).model("example:cloud"), /no un modelo cloud/);
    const created = await app.inject({
      headers: { authorization: "Bearer test-secret" },
      method: "POST",
      url: "/api/v1/knowledge/documents",
      payload: { title: "Documento largo", content: "decisiones de arquitectura ".repeat(180) },
    });
    const id = created.json().document.id;
    const report = await indexKnowledge(api, config);
    assert.equal(report.indexed, 1);
    const results = (await semanticSearch(api, config, "arquitectura")) as Array<{ id: string }>;
    assert.equal(results[0].id, id);
    assert.ok(requests.filter((r) => r.path === "/api/embed").length > 4);
    assert.ok(requests.every((r) => !JSON.stringify(r.body).includes("hardware")));
    const stale = await app.inject({
      headers: { authorization: "Bearer test-secret" },
      method: "PUT",
      url: `/api/v1/knowledge/documents/${id}/vector`,
      payload: {
        model: vectorSpace(config),
        embedding: [1, 0, 0],
        sourceHash: sourceHash({ title: "old", content: "changed" }),
      },
    });
    assert.equal(stale.statusCode, 409);
    const zero = await app.inject({
      headers: { authorization: "Bearer test-secret" },
      method: "PUT",
      url: `/api/v1/knowledge/documents/${id}/vector`,
      payload: { model: vectorSpace(config), embedding: [0, 0, 0] },
    });
    assert.equal(zero.statusCode, 400);
    digest = "digest-two";
    await assert.rejects(() => semanticSearch(api, config, "arquitectura"), /pesos del modelo cambiaron/);
    const page = await app.inject({
      headers: { authorization: "Bearer test-secret" },
      method: "GET",
      url: "/api/v1/knowledge/documents?limit=1",
    });
    assert.equal(page.json().nextOffset, 1);
    const next = await app.inject({
      headers: { authorization: "Bearer test-secret" },
      method: "GET",
      url: "/api/v1/knowledge/documents?limit=1&offset=1",
    });
    assert.equal(next.json().documents.length, 0);
  } finally {
    runtime.closeAllConnections();
    await new Promise<void>((resolve) => runtime.close(() => resolve()));
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
