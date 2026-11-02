import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiClient } from "@modai/sdk";
import { loadPackageSource } from "@sorodriguez/modai/package-source";

const server = process.env.MODAI_SERVER ?? "http://localhost:8787";
const api = new ApiClient(server, process.env.MODAI_API_TOKEN);
const root = resolve("examples/packages");

for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory())) {
  const input = loadPackageSource(join(root, entry.name));
  try {
    const item = await api.publish(input);
    process.stdout.write(`Publicado ${item.name}@${item.version}\n`);
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("PACKAGE_EXISTS")) process.stdout.write(`Ya existe ${input.manifest.name}@${input.manifest.version}\n`);
    else throw error;
  }
}
