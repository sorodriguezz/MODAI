import { AppError } from "@modai/contracts/errors";
import { assertSafeRelativePath } from "@modai/contracts/security";

/** Paths the Core owns. No package or adapter may write them. */
const CORE_OWNED = [/^modai\.(yaml|lock)$/i, /^\.modai\/(store|memory|grants)(\/|\.|$)/i, /^\.modai\/context-index\.json$/i, /^\.modai\/(manifest|lock|config)\.yaml$/i, /^\.modai\/activation\.json$/i];
const BLOCKED_SEGMENTS = new Set([".git", ".github", ".vscode", ".idea", "node_modules", ".ssh"]);

export function assertWritableTarget(target: string): string {
  assertSafeRelativePath(target, "target");
  const normalized = target.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some(segment => !segment || segment === "." || /[:\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || BLOCKED_SEGMENTS.has(segment.toLowerCase()) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) {
    throw new AppError(400, "UNSAFE_TARGET", `Destino reservado: ${target}`);
  }
  if (CORE_OWNED.some(pattern => pattern.test(normalized))) throw new AppError(400, "UNSAFE_TARGET", `Destino administrado por el Core: ${target}`);
  return normalized;
}

/**
 * Permission needed to write a path produced by an adapter. The Core does not know which
 * agent reads a path: everything outside MODAI's own folders is "agent instructions".
 */
export function adapterTargetPermission(target: string): "project.instructions" | undefined {
  const normalized = assertWritableTarget(target);
  if (/^\.(modai|agents)\//.test(normalized)) return undefined;
  // Generic containment, not agent knowledge: adapters write either inside a dot-directory
  // (agent configuration) or a root-level document/config file, never into source trees or
  // locations that tools execute automatically.
  const [first] = normalized.split("/");
  const rootFile = !normalized.includes("/");
  if (EXECUTION_HOOKS.has(first.toLowerCase())) throw new AppError(400, "UNSAFE_TARGET", `Destino que ejecuta código automáticamente: ${target}`);
  if (rootFile ? !/\.(md|mdc|json|jsonc|ya?ml|toml|txt)$/i.test(normalized) : !first.startsWith(".")) {
    throw new AppError(400, "UNSAFE_TARGET", `Un adaptador solo escribe en carpetas ocultas de configuración o en documentos de la raíz: ${target}`);
  }
  return "project.instructions";
}

const EXECUTION_HOOKS = new Set([".husky", ".githooks", ".devcontainer", ".circleci", ".gitlab", ".buildkite", ".direnv", ".envrc", ".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs", "package.json", "makefile", ".gitlab-ci.yml", ".travis.yml"]);

/** Expands {placeholders}; values are sanitised so a contribution name can never introduce path segments. */
export function expandTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new AppError(400, "INVALID_TEMPLATE", `Marcador desconocido ${match} en ${template}`);
    return value.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]/g, "-");
  });
}
