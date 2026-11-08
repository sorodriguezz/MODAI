import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const ORGANIZATION = "Pruebas";

export async function createNamespaces(app: FastifyInstance, token: string, names: string[]): Promise<string> {
  const headers = { authorization: `Bearer ${token}` };
  const listed = await app.inject({ method: "GET", url: "/api/v1/organizations", headers });
  let organization = (listed.json().organizations as Array<{ id: string; name: string }>).find(
    (item) => item.name === ORGANIZATION,
  );
  if (!organization) {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers,
      payload: { name: ORGANIZATION },
    });
    assert.equal(created.statusCode, 201, created.body);
    organization = created.json().organization;
  }
  for (const name of new Set(names)) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/namespaces",
      headers,
      payload: { name, organizationId: organization!.id, visibility: "shared" },
    });
    assert.ok([201, 409].includes(response.statusCode), response.body);
  }
  return organization!.id;
}

export function exampleNamespaces(root = join(process.cwd(), "examples", "packages")): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(
      (entry) =>
        /name:\s*"?(@[a-z0-9][a-z0-9._-]*)\//.exec(
          readFileSync(join(root, entry.name, "modai.package.yaml"), "utf8"),
        )?.[1],
    )
    .filter((name): name is string => Boolean(name));
}
