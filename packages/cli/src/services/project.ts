import { resolve } from "node:path";
import { isV1Project, loadV1Project, type V1Project } from "@modai/core";

export function requireProject(root = process.cwd()): string {
  if (isV1Project(root)) return resolve(root);
  throw new Error("No es un proyecto MODAI: ejecuta 'modai init'.");
}

export function currentProject(root = process.cwd()): V1Project | undefined {
  return isV1Project(root) ? loadV1Project(root) : undefined;
}
