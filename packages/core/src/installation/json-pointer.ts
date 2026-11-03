import { AppError } from "@modai/contracts/errors";
import { UNSAFE_JSON_KEYS } from "@modai/contracts/manifest";
import { sha256 } from "@modai/contracts/security";

// why: checked again here even if the adapter schema already refused them, so no pointer can ever reach Object.prototype.
function pointerKeys(pointer: string): string[] {
  const keys = pointer.split(".");
  if (keys.some((key) => UNSAFE_JSON_KEYS.has(key)))
    throw new AppError(400, "UNSAFE_POINTER", `Puntero JSON no permitido: ${pointer}`);
  return keys;
}

export function getPointer(value: unknown, pointer: string): unknown {
  return pointerKeys(pointer).reduce<unknown>(
    (node, key) =>
      node && typeof node === "object" && Object.hasOwn(node, key) ? (node as Record<string, unknown>)[key] : undefined,
    value,
  );
}

export function setPointer(value: Record<string, unknown>, pointer: string, next: unknown): void {
  const keys = pointerKeys(pointer);
  let node = value;
  for (const key of keys.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== "object" || Array.isArray(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  if (next === undefined) delete node[keys.at(-1)!];
  else node[keys.at(-1)!] = next;
}

export function pruneEmpty(value: Record<string, unknown>): void {
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      pruneEmpty(child as Record<string, unknown>);
      if (!Object.keys(child).length) delete value[key];
    }
  }
}

export const jsonHash = (value: unknown) => sha256(JSON.stringify(value ?? null));
