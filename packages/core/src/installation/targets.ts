import { AppError } from "@modai/contracts/errors";
import { assertSafeRelativePath, isReservedPathSegment } from "@modai/contracts/security";

const CORE_OWNED = [
  /^modai\.(yaml|lock)$/i,
  /^\.modai\/(store|memory|grants)(\/|\.|$)/i,
  /^\.modai\/context-index\.json$/i,
  /^\.modai\/(manifest|lock|config)\.yaml$/i,
  /^\.modai\/activation\.json$/i,
];
export function assertWritableTarget(target: string): string {
  assertSafeRelativePath(target, "target");
  const normalized = target.replaceAll("\\", "/");
  if (normalized.split("/").some(isReservedPathSegment))
    throw new AppError(400, "UNSAFE_TARGET", `Destino reservado: ${target}`);
  if (CORE_OWNED.some((pattern) => pattern.test(normalized)))
    throw new AppError(400, "UNSAFE_TARGET", `Destino administrado por el Core: ${target}`);
  return normalized;
}

export function adapterTargetPermission(target: string): "project.instructions" | undefined {
  const normalized = assertWritableTarget(target);
  if (/^\.(modai|agents)\//.test(normalized)) return undefined;
  const [first] = normalized.split("/");
  const rootFile = !normalized.includes("/");
  if (EXECUTION_HOOKS.has(first.toLowerCase()))
    throw new AppError(400, "UNSAFE_TARGET", `Destino que ejecuta código automáticamente: ${target}`);
  if (rootFile ? !/\.(md|mdc|json|jsonc|ya?ml|toml|txt)$/i.test(normalized) : !first.startsWith(".")) {
    throw new AppError(
      400,
      "UNSAFE_TARGET",
      `Un adaptador solo escribe en carpetas ocultas de configuración o en documentos de la raíz: ${target}`,
    );
  }
  return "project.instructions";
}

export function componentTargetPermission(target: string): "project.source" {
  const normalized = assertWritableTarget(target);
  const segments = normalized.split("/");
  if (segments.length < 2)
    throw new AppError(
      400,
      "UNSAFE_TARGET",
      `Un componente se instala dentro de una carpeta, no en la raíz del proyecto: ${target}`,
    );
  if (segments[0].startsWith(".") || EXECUTION_HOOKS.has(segments[0].toLowerCase()))
    throw new AppError(
      400,
      "UNSAFE_TARGET",
      `Un componente no escribe en carpetas ocultas ni de configuración: ${target}`,
    );
  return "project.source";
}

const EXECUTION_HOOKS = new Set([
  ".husky",
  ".githooks",
  ".devcontainer",
  ".circleci",
  ".gitlab",
  ".buildkite",
  ".direnv",
  ".envrc",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  "package.json",
  "makefile",
  ".gitlab-ci.yml",
  ".travis.yml",
]);

export function expandTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined)
      throw new AppError(400, "INVALID_TEMPLATE", `Marcador desconocido ${match} en ${template}`);
    return value.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]/g, "-");
  });
}
