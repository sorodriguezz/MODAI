import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApp } from "../src/app.js";
import { createNamespaces } from "./support/namespaces.js";
import { testDatabase } from "./support/test-database.js";

const root = mkdtempSync(join(tmpdir(), "modai-admin-auth-"));
const bootstrap = "admin-auth-bootstrap-secret";
const app = await createApp({
  ...(await testDatabase(join(root, "db.sqlite"))),
  artifactDirectory: join(root, "artifacts"),
  apiToken: bootstrap,
  logger: false,
  adminDirectory: false,
  initialAdmin: false,
  loginDelayMs: 0,
  loginRateLimitMax: 1000,
});
await createNamespaces(app, bootstrap, ["@cli"]);
after(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

const bearer = { authorization: `Bearer ${bootstrap}` };
const csrf = { "x-modai-csrf": "1" };
const adminPassword = "contraseña-admin-segura";

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : String(header ?? "");
  const match = /modai_session=([^;]*)/.exec(value);
  assert.ok(match?.[1], `sin cookie de sesión: ${value}`);
  return `modai_session=${match[1]}`;
}

async function login(username: string, password: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: csrf,
    payload: { username, password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return sessionCookie(response);
}

let adminCookie = "";

test("el primer administrador exige el token de instalación", async () => {
  const status = await app.inject({ method: "GET", url: "/api/v1/auth/status" });
  assert.equal(status.json().setupRequired, true);
  assert.equal(status.json().authenticated, false);

  const noCsrf = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: { bootstrapToken: bootstrap, username: "admin", password: adminPassword },
  });
  assert.equal(noCsrf.statusCode, 403);
  const wrong = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: csrf,
    payload: { bootstrapToken: "otro", username: "admin", password: adminPassword },
  });
  assert.equal(wrong.statusCode, 401);
  const weak = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: csrf,
    payload: { bootstrapToken: bootstrap, username: "admin", password: "corta" },
  });
  assert.equal(weak.statusCode, 400);
  assert.equal(weak.json().error.code, "WEAK_PASSWORD");

  const created = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: csrf,
    payload: { bootstrapToken: bootstrap, username: "Admin", displayName: "Administración", password: adminPassword },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().user.username, "admin");
  assert.equal(created.json().user.role, "admin");
  assert.equal(created.json().user.passwordHash, undefined);
  const cookie = String(created.headers["set-cookie"]);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Secure/);
  adminCookie = sessionCookie(created);

  const again = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    headers: csrf,
    payload: { bootstrapToken: bootstrap, username: "otro", password: adminPassword },
  });
  assert.equal(again.statusCode, 409);
  const after = await app.inject({ method: "GET", url: "/api/v1/auth/status", headers: { cookie: adminCookie } });
  assert.equal(after.json().setupRequired, false);
  assert.equal(after.json().user.username, "admin");
});

test("login, credenciales incorrectas y logout", async () => {
  const wrong = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: csrf,
    payload: { username: "admin", password: "no-es-la-clave" },
  });
  assert.equal(wrong.statusCode, 401);
  const unknown = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: csrf,
    payload: { username: "nadie", password: "no-es-la-clave" },
  });
  assert.equal(unknown.statusCode, 401);
  assert.equal(wrong.json().error.message, unknown.json().error.message, "el mensaje no revela si el usuario existe");
  assert.equal(wrong.headers["set-cookie"], undefined);
  const noCsrf = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { username: "admin", password: adminPassword },
  });
  assert.equal(noCsrf.statusCode, 403);

  const cookie = await login("ADMIN", adminPassword);
  const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().identity.kind, "user");
  assert.equal(me.json().user.lastLoginAt !== undefined, true);

  const logout = await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie, ...csrf } });
  assert.equal(logout.statusCode, 204);
  assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
  assert.equal((await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } })).statusCode, 401);
  const audit = (await app.inject({ method: "GET", url: "/api/v1/admin/audit", headers: bearer }))
    .json()
    .events.map((e: { action: string }) => e.action);
  for (const action of ["auth.setup", "auth.login", "auth.login-failed", "auth.logout"])
    assert.ok(audit.includes(action), action);
});

test("la sesión usa los mismos roles y proyectos que las API keys", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: { cookie: adminCookie, ...csrf },
    payload: { username: "lectora", displayName: "Lectora", password: "lectura-segura-01", role: "reader" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const reader = await login("lectora", "lectura-segura-01");

  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/packages", headers: { cookie: reader } })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/session", headers: { cookie: reader } })).json().role,
    "reader",
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: { cookie: reader } })).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/admin/api-keys", headers: { cookie: reader } })).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/knowledge/documents",
        headers: { cookie: reader, ...csrf },
        payload: { title: "x", content: "y" },
      })
    ).statusCode,
    403,
  );

  const project = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    headers: { cookie: adminCookie, ...csrf },
    payload: { id: "proyecto-panel", name: "Proyecto panel" },
  });
  assert.equal(project.statusCode, 201, project.body);
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/memories?projectId=proyecto-panel", headers: { cookie: reader } }))
      .statusCode,
    403,
  );
  const id = created.json().user.id;
  const granted = await app.inject({
    method: "PATCH",
    url: `/api/v1/admin/users/${id}`,
    headers: { cookie: adminCookie, ...csrf },
    payload: { role: "publisher", projectIds: ["proyecto-panel"] },
  });
  assert.equal(granted.statusCode, 200, granted.body);
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/memories?projectId=proyecto-panel", headers: { cookie: reader } }))
      .statusCode,
    200,
    "el cambio de rol aplica a la sesión abierta",
  );
  const memory = await app.inject({
    method: "POST",
    url: "/api/v1/memories",
    headers: { cookie: reader, ...csrf },
    payload: { projectId: "proyecto-panel", content: "decisión desde el panel" },
  });
  assert.equal(memory.statusCode, 201, memory.body);
});

test("las escrituras con cookie exigen la cabecera CSRF y un origen propio", async () => {
  const blocked = await app.inject({
    method: "POST",
    url: "/api/v1/knowledge/documents",
    headers: { cookie: adminCookie },
    payload: { title: "CSRF", content: "no" },
  });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().error.code, "CSRF_REQUIRED");
  const foreign = await app.inject({
    method: "POST",
    url: "/api/v1/knowledge/documents",
    headers: { cookie: adminCookie, ...csrf, origin: "https://evil.example" },
    payload: { title: "CSRF", content: "no" },
  });
  assert.equal(foreign.statusCode, 403);
  assert.equal(foreign.json().error.code, "CSRF_ORIGIN");
  const allowed = await app.inject({
    method: "POST",
    url: "/api/v1/knowledge/documents",
    headers: { cookie: adminCookie, ...csrf, host: "localhost:80", origin: "http://localhost:80" },
    payload: { title: "CSRF", content: "sí" },
  });
  assert.equal(allowed.statusCode, 201, allowed.body);
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/knowledge/documents", headers: { cookie: adminCookie } }))
      .statusCode,
    200,
    "las lecturas no necesitan cabecera",
  );
});

test("protege al último administrador y la propia cuenta", async () => {
  const me = (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: adminCookie } })).json()
    .user;
  const headers = { cookie: adminCookie, ...csrf };
  assert.equal((await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${me.id}`, headers })).statusCode, 409);
  assert.equal(
    (await app.inject({ method: "PATCH", url: `/api/v1/admin/users/${me.id}`, headers, payload: { disabled: true } }))
      .statusCode,
    409,
  );
  assert.equal(
    (await app.inject({ method: "PATCH", url: `/api/v1/admin/users/${me.id}`, headers, payload: { role: "reader" } }))
      .statusCode,
    409,
  );
  const lastAdmin = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${me.id}`, headers: bearer });
  assert.equal(lastAdmin.statusCode, 409);
  assert.equal(lastAdmin.json().error.code, "LAST_ADMIN");
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/v1/admin/users/${me.id}`,
        headers: bearer,
        payload: { role: "reader" },
      })
    ).json().error.code,
    "LAST_ADMIN",
  );

  const second = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers,
    payload: { username: "segunda-admin", password: "segunda-admin-clave", role: "admin" },
  });
  assert.equal(second.statusCode, 201, second.body);
  const secondCookie = await login("segunda-admin", "segunda-admin-clave");
  const disabled = await app.inject({
    method: "PATCH",
    url: `/api/v1/admin/users/${second.json().user.id}`,
    headers,
    payload: { disabled: true },
  });
  assert.equal(disabled.statusCode, 200);
  assert.ok(disabled.json().user.disabledAt);
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: secondCookie } })).statusCode,
    401,
    "desactivar cierra sus sesiones",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: csrf,
        payload: { username: "segunda-admin", password: "segunda-admin-clave" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${second.json().user.id}`, headers })).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${second.json().user.id}`, headers })).statusCode,
    404,
  );
});

test("cambio de contraseña propio y restablecimiento por un admin", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: { cookie: adminCookie, ...csrf },
    payload: { username: "rotacion", password: "clave-inicial-01", role: "reader" },
  });
  const id = created.json().user.id;
  const first = await login("rotacion", "clave-inicial-01"),
    second = await login("rotacion", "clave-inicial-01");
  const wrong = await app.inject({
    method: "POST",
    url: "/api/v1/auth/password",
    headers: { cookie: first, ...csrf },
    payload: { currentPassword: "incorrecta-xx", newPassword: "clave-nueva-0002" },
  });
  assert.equal(wrong.statusCode, 400);
  const short = await app.inject({
    method: "POST",
    url: "/api/v1/auth/password",
    headers: { cookie: first, ...csrf },
    payload: { currentPassword: "clave-inicial-01", newPassword: "corta" },
  });
  assert.equal(short.statusCode, 400);
  const changed = await app.inject({
    method: "POST",
    url: "/api/v1/auth/password",
    headers: { cookie: first, ...csrf },
    payload: { currentPassword: "clave-inicial-01", newPassword: "clave-nueva-0002" },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: first } })).statusCode,
    200,
    "la sesión actual sigue activa",
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: second } })).statusCode,
    401,
    "otras sesiones se cierran",
  );
  await login("rotacion", "clave-nueva-0002");

  const reset = await app.inject({
    method: "PATCH",
    url: `/api/v1/admin/users/${id}`,
    headers: { cookie: adminCookie, ...csrf },
    payload: { password: "clave-restablecida-3" },
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: first } })).statusCode,
    401,
  );
  await login("rotacion", "clave-restablecida-3");
  const duplicate = await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: { cookie: adminCookie, ...csrf },
    payload: { username: "ROTACION", password: "otra-clave-larga", role: "reader" },
  });
  assert.equal(duplicate.statusCode, 409);
});

test("las API keys Bearer siguen funcionando sin cookie ni CSRF", async () => {
  const key = await app.inject({
    method: "POST",
    url: "/api/v1/admin/api-keys",
    headers: bearer,
    payload: { label: "cli", role: "publisher", projectIds: ["proyecto-panel"], packageScopes: ["@cli"] },
  });
  assert.equal(key.statusCode, 201);
  const auth = { authorization: `Bearer ${key.json().key.token}` };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/knowledge/documents",
        headers: auth,
        payload: { title: "Desde CLI", content: "ok", packageName: "@cli/guias" },
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth })).json().identity.kind,
    "api-key",
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/api/v1/session",
        headers: { authorization: "Bearer inválido", cookie: adminCookie },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/password",
        headers: { ...auth },
        payload: { currentPassword: "x", newPassword: "yyyyyyyyyyyy" },
      })
    ).statusCode,
    400,
  );
});

test("bloquea el usuario tras varios intentos fallidos", async () => {
  await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: { cookie: adminCookie, ...csrf },
    payload: { username: "bloqueo", password: "clave-correcta-01", role: "reader" },
  });
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          headers: csrf,
          payload: { username: "bloqueo", password: "incorrecta-" + i },
        })
      ).statusCode,
      401,
    );
  const locked = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: csrf,
    payload: { username: "bloqueo", password: "clave-correcta-01" },
  });
  assert.equal(locked.statusCode, 429);
  const elsewhere = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    remoteAddress: "10.0.0.9",
    headers: csrf,
    payload: { username: "bloqueo", password: "clave-correcta-01" },
  });
  assert.equal(elsewhere.statusCode, 200);
});

test("/health no revela el runtime sin sesión y validar o importar .skill exige publicar", async () => {
  const anonymous = (await app.inject({ method: "GET", url: "/health" })).json();
  assert.equal(anonymous.runtime, undefined);
  assert.equal(typeof anonymous.signaturePolicy, "string");
  assert.match((await app.inject({ method: "GET", url: "/health", headers: bearer })).json().runtime, /^v\d+/);
  const reader = await app.inject({
    method: "POST",
    url: "/api/v1/admin/api-keys",
    headers: bearer,
    payload: { label: "lector-skill", role: "reader" },
  });
  const readerAuth = { authorization: `Bearer ${reader.json().key.token}` };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/packages/import-skill",
        headers: readerAuth,
        payload: { archive: "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==", namespace: "@x", dryRun: true },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/packages/validate",
        headers: readerAuth,
        payload: { manifest: {}, files: [] },
      })
    ).statusCode,
    403,
  );
});

test("importar un backup es todo o nada", async () => {
  const before = (await app.inject({ method: "GET", url: "/api/v1/projects", headers: bearer })).json().projects.length;
  const broken = await app.inject({
    method: "POST",
    url: "/api/v1/admin/import",
    headers: bearer,
    payload: {
      schemaVersion: 1,
      projects: [{ id: "restaurado-a-medias", name: "No debe quedar", createdAt: new Date().toISOString() }],
      packages: [
        {
          manifest: {
            apiVersion: "modai.dev/v1",
            kind: "Package",
            metadata: { name: "@roto/x", version: "1.0.0", description: "paquete con hash incorrecto" },
            spec: {},
          },
          files: [{ path: "a.md", content: Buffer.from("a").toString("base64"), sha256: "0".repeat(64) }],
        },
      ],
    },
  });
  assert.equal(broken.statusCode, 400, broken.body);
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/v1/projects", headers: bearer })).json().projects.length,
    before,
  );
});

test("siembra el administrador inicial desde la configuración y exige contraseña fuerte", async () => {
  const dir = mkdtempSync(join(tmpdir(), "modai-admin-seed-"));
  try {
    const base = {
      ...(await testDatabase(join(dir, "db.sqlite"))),
      artifactDirectory: join(dir, "artifacts"),
      logger: false,
      adminDirectory: false as const,
      loginDelayMs: 0,
    };
    await assert.rejects(
      () => createApp({ ...base, initialAdmin: { username: "root", password: "corta" } }),
      /al menos 10/,
    );
    const seeded = await createApp({ ...base, initialAdmin: { username: "root", password: "semilla-segura-01" } });
    try {
      assert.equal((await seeded.inject({ method: "GET", url: "/api/v1/auth/status" })).json().setupRequired, false);
      const response = await seeded.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: csrf,
        payload: { username: "root", password: "semilla-segura-01" },
      });
      assert.equal(response.statusCode, 200);
      const setup = await seeded.inject({
        method: "POST",
        url: "/api/v1/auth/setup",
        headers: csrf,
        payload: { bootstrapToken: "x", username: "otro", password: "semilla-segura-01" },
      });
      assert.equal(setup.statusCode, 409);
    } finally {
      await seeded.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("la cookie es Secure cuando la URL pública es HTTPS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "modai-admin-https-"));
  const secure = await createApp({
    ...(await testDatabase(join(dir, "db.sqlite"))),
    artifactDirectory: join(dir, "artifacts"),
    logger: false,
    adminDirectory: false,
    apiToken: bootstrap,
    publicUrl: "https://modai.example",
    initialAdmin: false,
    loginDelayMs: 0,
  });
  try {
    const response = await secure.inject({
      method: "POST",
      url: "/api/v1/auth/setup",
      headers: csrf,
      payload: { bootstrapToken: bootstrap, username: "admin", password: adminPassword },
    });
    assert.equal(response.statusCode, 201);
    assert.match(String(response.headers["set-cookie"]), /; Secure/);
  } finally {
    await secure.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
