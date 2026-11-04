import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { manifestIdentity } from "@modai/core";
import { ApiClient } from "@modai/sdk";
import { loadPackageSource } from "@sorodriguez/modai/package-source";

const server = process.env.MODAI_SERVER ?? "http://localhost:8787";
const api = new ApiClient(server, process.env.MODAI_API_TOKEN);
const root = resolve("examples/packages");
const EXAMPLES_ORGANIZATION = "Ejemplos MODAI";

const sources = readdirSync(root, { withFileTypes: true })
  .filter((item) => item.isDirectory())
  .map((entry) => loadPackageSource(join(root, entry.name)));

// why: every package lives in a namespace with an owner; the examples' namespaces belong to one organization.
async function ensureNamespaces(): Promise<void> {
  const existing = new Set((await api.namespaces()).map((item) => item.name));
  const missing = [...new Set(sources.map((input) => manifestIdentity(input.manifest).name.split("/")[0]))].filter(
    (name) => !existing.has(name),
  );
  if (!missing.length) return;
  const organization =
    (await api.organizations()).find((item) => item.name === EXAMPLES_ORGANIZATION) ??
    (await api.createOrganization(EXAMPLES_ORGANIZATION, "Dueña de los paquetes de ejemplo"));
  for (const name of missing) {
    await api.createNamespace({ name, organizationId: organization.id });
    process.stdout.write(`Namespace ${name} creado (${EXAMPLES_ORGANIZATION})\n`);
  }
}

await ensureNamespaces();
for (const input of sources) {
  try {
    const item = await api.publish(input);
    process.stdout.write(`Publicado ${item.name}@${item.version}\n`);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("PACKAGE_EXISTS"))
      process.stdout.write(
        `Ya existe ${manifestIdentity(input.manifest).name}@${manifestIdentity(input.manifest).version}\n`,
      );
    else throw error;
  }
}
