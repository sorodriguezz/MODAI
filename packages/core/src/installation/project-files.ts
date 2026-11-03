import { existsSync, readFileSync } from "node:fs";
import { AppError } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import { safeProjectPath } from "./fs.js";
import { managedContentHash } from "./managed-blocks.js";

export function readText(root: string, path: string): string | undefined {
  const absolute = safeProjectPath(root, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
}

export function currentHash(root: string, path: string): string | undefined {
  const absolute = safeProjectPath(root, path);
  return existsSync(absolute) ? sha256(readFileSync(absolute)) : undefined;
}

export function managedHash(root: string, path: string): string | undefined {
  const absolute = safeProjectPath(root, path);
  return existsSync(absolute) ? managedContentHash(readFileSync(absolute)) : undefined;
}

export function readJson(root: string, path: string): Record<string, unknown> {
  const text = readText(root, path);
  if (!text?.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new AppError(409, "JSON_CONFLICT", `${path} no es un objeto JSON válido; corrígelo antes de sincronizar`);
  }
}
