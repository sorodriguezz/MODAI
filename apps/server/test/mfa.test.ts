import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { base32, totp } from "../src/modules/auth/totp.js";
import { testDatabase } from "./support/test-database.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decode(secret: string): Buffer {
  const bits = [...secret].map((value) => alphabet.indexOf(value).toString(2).padStart(5, "0")).join("");
  return Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
}

test("TOTP coincide con los vectores SHA-1 de RFC 6238", () => {
  const key = Buffer.from("12345678901234567890");
  assert.equal(base32(key), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  for (const [unix, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [20000000000, "65353130"],
  ] as const)
    assert.equal(totp(key, Math.floor(unix / 30), 8), expected);
});

test("MFA personal con caducidad, reinicio, revocación y consumo atómico de códigos", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "modai-mfa-"));
  const token = "mfa-test-bootstrap";
  const username = "admin";
  const password = "pass-mfa-test-segura";
  const options = {
    ...(await testDatabase(join(root, "modai.db"))),
    artifactDirectory: join(root, "artifacts"),
    apiToken: token,
    logger: false,
    adminDirectory: false as const,
    initialAdmin: { username, password },
    loginDelayMs: 0,
    loginRateLimitMax: 1000,
  };
  let app = await createApp(options);
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const post = (path: string, payload: object, cookie?: string) =>
    app.inject({
      method: "POST",
      url: `/api/v1/auth/${path}`,
      headers: { "x-modai-csrf": "1", ...(cookie && { cookie }) },
      payload,
    });
  const login = (code?: string) => post("login", { username, password, code });
  const session = async (code?: string) => {
    const response = await login(code);
    assert.equal(response.statusCode, 200, response.body);
    return String(response.headers["set-cookie"]).split(";")[0];
  };
  const status = (cookie: string) => app.inject({ url: "/api/v1/auth/mfa", headers: { cookie } });
  const first = await session();
  const second = await session();
  assert.deepEqual((await status(first)).json(), { enabled: false, recoveryCodesRemaining: 0 });
  const forbidden = await app.inject({ url: "/api/v1/auth/mfa", headers: { authorization: `Bearer ${token}` } });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(
    (await post("mfa/setup", { currentPassword: "incorrecta" }, first)).json().error.code,
    "INVALID_PASSWORD",
  );
  const draft = await post("mfa/setup", { currentPassword: password }, first);
  assert.equal(draft.statusCode, 200, draft.body);
  assert.equal(draft.headers["cache-control"], "no-store");
  const { secret, setupToken } = draft.json();
  const key = decode(secret);
  const step = () => Math.floor(Date.now() / 30_000);
  const verification = () => ({ setupToken, code: totp(key, step() - 1) });
  assert.equal((await post("mfa/confirm", verification(), second)).json().error.code, "MFA_SETUP_EXPIRED");
  const originalNow = Date.now();
  const future = t.mock.method(Date, "now", () => originalNow + 11 * 60_000);
  try {
    assert.equal((await post("mfa/confirm", verification(), first)).json().error.code, "MFA_SETUP_EXPIRED");
  } finally {
    future.mock.restore();
  }
  const enrollment = verification();
  const activated = await post("mfa/confirm", enrollment, first);
  assert.equal(activated.statusCode, 200, activated.body);
  const { recoveryCodes } = activated.json();
  assert.equal(new Set(recoveryCodes).size, 10);
  assert.equal((await status(second)).statusCode, 401);
  assert.deepEqual((await status(first)).json(), { enabled: true, recoveryCodesRemaining: 10 });
  const missing = await login();
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.json().error.code, "MFA_REQUIRED");
  assert.equal(missing.headers["set-cookie"], undefined);
  assert.equal((await login(enrollment.code)).json().error.code, "INVALID_MFA");
  await app.close();
  app = await createApp(options);
  const current = totp(key, step());
  const sameTotp = await Promise.all([login(current), login(current)]);
  assert.deepEqual(sameTotp.map((result) => result.statusCode).sort(), [200, 401]);
  const sameRecovery = await Promise.all([login(recoveryCodes[0]), login(recoveryCodes[0])]);
  assert.deepEqual(sameRecovery.map((result) => result.statusCode).sort(), [200, 401]);
  assert.deepEqual((await status(first)).json(), { enabled: true, recoveryCodesRemaining: 9 });
  const rotated = await post("mfa/recovery", { currentPassword: password, code: recoveryCodes[1] }, first);
  assert.equal(rotated.statusCode, 200, rotated.body);
  assert.equal((await login(recoveryCodes[2])).json().error.code, "INVALID_MFA");
  const disabled = await post(
    "mfa/disable",
    { currentPassword: password, code: rotated.json().recoveryCodes[0] },
    first,
  );
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal((await post("mfa/confirm", verification(), first)).json().error.code, "MFA_SETUP_EXPIRED");
  assert.deepEqual((await status(await session())).json(), { enabled: false, recoveryCodesRemaining: 0 });
});
