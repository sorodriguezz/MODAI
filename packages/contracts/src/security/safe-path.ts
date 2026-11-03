import { isAbsolute, posix, win32 } from "node:path";
import { AppError } from "../errors.js";

const BLOCKED_SEGMENTS = new Set([".git", ".github", ".vscode", ".idea", "node_modules", ".ssh"]);

export function assertSafeRelativePath(value: string, label = "path"): void {
  if (typeof value !== "string") throw new AppError(400, "UNSAFE_PATH", `${label} inválido`);
  const normalized = value.replaceAll("\\", "/");
  if (
    !value ||
    value.includes("\0") ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    normalized.startsWith("/") ||
    posix.normalize(normalized).startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new AppError(400, "UNSAFE_PATH", `${label} no es una ruta relativa segura: ${value}`);
  }
}

export function isReservedPathSegment(segment: string): boolean {
  return (
    !segment ||
    segment === "." ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what this rejects
    /[:\x00-\x1f]/.test(segment) ||
    /[. ]$/.test(segment) ||
    BLOCKED_SEGMENTS.has(segment.toLowerCase()) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  );
}

export function requiredTargetPermission(target: string): "project.instructions" | "project.files" | undefined {
  assertSafeRelativePath(target, "target");
  const normalized = target.replaceAll("\\", "/");
  if (normalized.split("/").some(isReservedPathSegment))
    throw new AppError(400, "UNSAFE_TARGET", `Destino reservado: ${target}`);
  if (
    /^(?:\.agents\/(?:skills|harness)\/|\.modai\/(?:packages|adapters|integrations)\/)/.test(normalized) ||
    /^\.modai\/[a-z0-9-]+\.md$/i.test(normalized)
  )
    return undefined;
  if (/^(?:AGENTS\.md|CLAUDE\.md|\.agent\/|\.opencode\/agents\/)/.test(normalized)) return "project.instructions";
  if (/^docs\//.test(normalized)) return "project.files";
  throw new AppError(400, "UNSAFE_TARGET", `Destino no permitido: ${target}`);
}
