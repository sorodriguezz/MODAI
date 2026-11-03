import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// The client config path is fixed when the module loads: point it at a temporary folder first.
const config = mkdtempSync(join(tmpdir(), "modai-connection-"));
process.env.MODAI_CONFIG_DIR = config;
const { effectiveConnection, insecureTransport } = await import("../packages/cli/src/cli/connection.ts");

const withEnv = (vars: Record<string, string | undefined>, run: () => void) => {
  const previous = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { run(); } finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
};

test("MODAI_API_TOKEN solo viaja a su servidor, nunca a un registry de un modai.yaml ajeno", () => {
  withEnv({ MODAI_SERVER: "https://modai.empresa.dev", MODAI_API_TOKEN: "secreto-ci" }, () => {
    assert.equal(effectiveConnection().token, "secreto-ci");
    assert.equal(effectiveConnection("https://modai.empresa.dev/").token, "secreto-ci");
    assert.equal(effectiveConnection("https://evil.example").token, undefined);
  });
});

test("el token guardado va solo al servidor con el que se guardó", () => {
  writeFileSync(join(config, "client.yaml"), "server: https://modai.empresa.dev\ntoken: guardado\n");
  withEnv({ MODAI_SERVER: undefined, MODAI_API_TOKEN: undefined }, () => {
    assert.equal(effectiveConnection().token, "guardado");
    assert.equal(effectiveConnection("https://otro.example").token, undefined);
  });
  // MODAI_API_TOKEN without MODAI_SERVER belongs to the configured server.
  withEnv({ MODAI_SERVER: undefined, MODAI_API_TOKEN: "de-entorno" }, () => {
    assert.equal(effectiveConnection().token, "de-entorno");
    assert.equal(effectiveConnection("https://otro.example").token, undefined);
  });
});

test("no se envían credenciales por http salvo a este equipo o con permiso explícito", () => {
  assert.equal(insecureTransport("http://localhost:8787"), false);
  assert.equal(insecureTransport("http://127.0.0.1:8787"), false);
  assert.equal(insecureTransport("https://modai.empresa.dev"), false);
  assert.equal(insecureTransport("http://modai.interno:8787"), true);
  withEnv({ MODAI_SERVER: "http://modai.interno:8787", MODAI_API_TOKEN: "x", MODAI_ALLOW_INSECURE_HTTP: undefined }, () => {
    assert.throws(() => effectiveConnection(), /No se envían credenciales por http/);
  });
  withEnv({ MODAI_SERVER: "http://modai.interno:8787", MODAI_API_TOKEN: "x", MODAI_ALLOW_INSECURE_HTTP: "1" }, () => {
    assert.equal(effectiveConnection().token, "x");
  });
});
