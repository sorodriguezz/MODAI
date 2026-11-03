#!/usr/bin/env node
// Resolución independiente del directorio desde el que se invoca el script.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const lan = args.includes("--lan");
const publicDeployment = args.includes("--public");
const raspberry = args.includes("--pi");
if (lan && publicDeployment) throw new Error("Usa --lan o --public, no ambos");
const files = ["-f", resolve(root, "deploy/compose.yaml")];
if (lan) files.push("-f", resolve(root, "deploy/compose.lan.yaml"));
if (publicDeployment) files.push("-f", resolve(root, "deploy/compose.public.yaml"));
if (raspberry) files.push("-f", resolve(root, "deploy/compose.raspberry.yaml"));
const result = spawnSync(
  "docker",
  ["compose", ...files, ...args.filter((arg) => !["--lan", "--public", "--pi"].includes(arg))],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (result.error) {
  console.error(`No se pudo ejecutar Docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
