import { invariant } from "@modai/contracts/errors";

export function validateIncludes(include: string[], paths: Set<string>): void {
  for (const path of include)
    invariant(
      [...paths].some((file) => file === path || file.startsWith(`${path.replace(/\/$/, "")}/`)),
      400,
      "MISSING_SOURCE",
      `include no coincide con archivos: ${path}`,
    );
}
