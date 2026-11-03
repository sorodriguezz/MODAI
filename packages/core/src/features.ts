import { AppError } from "@modai/contracts/errors";

/**
 * Features: optional, named parts of a template or a package that the person switches on with flags
 * (`--sdd`, `--x-lib`) or off (`--no-lombok`). The same rules apply everywhere:
 *
 * - `default: true` features are on unless switched off.
 * - `requires` switches other features on together with this one.
 * - `conflicts` forbids combining two features.
 * - Names are lowercase (`x-lib`); they cannot start with `no-` (reserved to switch off) or clash with CLI options.
 */
export interface FeatureRule {
  name: string;
  description: string;
  default: boolean;
  requires: string[];
  conflicts: string[];
}

export const FEATURE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
/** Option names the commands that accept feature flags already use. */
export const RESERVED_FEATURE_NAMES = new Set([
  "var",
  "force",
  "help",
  "with",
  "dry-run",
  "version",
  "yes",
  "no",
  "allow",
  "keep-mine",
  "json",
  "registry",
  "sync",
  "frozen",
  "root",
  "depth",
  "filter",
  "fail-fast",
  "name",
  "description",
  "stack",
  "tags",
  "h",
  "v",
]);

/** Why `name` cannot be a feature name, or "" when it can. */
export function featureNameProblem(name: string): string {
  if (!FEATURE_NAME.test(name))
    return `"${name}" no es un nombre de feature válido: minúsculas, números y guiones, empezando por letra (por ejemplo "x-lib")`;
  if (name.startsWith("no-")) return `"${name}" empieza por "no-", que se usa para apagar features (--no-<nombre>)`;
  if (RESERVED_FEATURE_NAMES.has(name)) return `"${name}" está reservado para una opción de la CLI`;
  return "";
}

const fail = (message: string): never => {
  throw new AppError(422, "FEATURE_SELECTION", message);
};

/** Structural checks: references to unknown features, self references, `requires` cycles and incompatible defaults. */
export function assertFeatureRules(features: FeatureRule[], owner: string): void {
  const names = new Set(features.map((feature) => feature.name));
  for (const feature of features) {
    const problem = featureNameProblem(feature.name);
    if (problem) throw new AppError(400, "INVALID_FEATURE", `${owner}: ${problem}`);
    for (const ref of [...feature.requires, ...feature.conflicts])
      if (!names.has(ref))
        throw new AppError(
          400,
          "INVALID_FEATURE",
          `${owner}: la feature "${feature.name}" menciona "${ref}", que no está declarada`,
        );
    if (feature.requires.includes(feature.name) || feature.conflicts.includes(feature.name))
      throw new AppError(
        400,
        "INVALID_FEATURE",
        `${owner}: "${feature.name}" no puede requerirse ni oponerse a sí misma`,
      );
    for (const required of feature.requires)
      if (feature.conflicts.includes(required))
        throw new AppError(
          400,
          "INVALID_FEATURE",
          `${owner}: "${feature.name}" requiere y a la vez se opone a "${required}"`,
        );
  }
  const byName = new Map(features.map((feature) => [feature.name, feature]));
  const done = new Set<string>();
  const visit = (name: string, chain: string[]) => {
    if (chain.includes(name))
      throw new AppError(
        400,
        "INVALID_FEATURE",
        `${owner}: "requires" forma un ciclo (${[...chain, name].join(" → ")})`,
      );
    if (done.has(name)) return;
    for (const required of byName.get(name)?.requires ?? []) visit(required, [...chain, name]);
    done.add(name);
  };
  for (const feature of features) visit(feature.name, []);
  // Every feature must be selectable: what it brings along through `requires` cannot conflict with itself.
  for (const feature of features) {
    const closure = requiresClosure(features, feature.name);
    for (const name of closure)
      for (const other of byName.get(name)!.conflicts) {
        if (closure.includes(other))
          throw new AppError(
            400,
            "INVALID_FEATURE",
            `${owner}: "${feature.name}" no se puede activar nunca: trae "${name}" y "${other}", que no se combinan`,
          );
      }
  }
  // With no flags at all the defaults must be a valid combination.
  try {
    selectFeatures(features, {}, owner);
  } catch (error) {
    throw new AppError(400, "INVALID_FEATURE", (error as Error).message);
  }
}

/** A feature and everything it brings along through `requires`. */
export function requiresClosure(features: FeatureRule[], name: string): string[] {
  const byName = new Map(features.map((feature) => [feature.name, feature]));
  const seen: string[] = [];
  const visit = (current: string) => {
    if (seen.includes(current)) return;
    seen.push(current);
    for (const required of byName.get(current)?.requires ?? []) visit(required);
  };
  visit(name);
  return seen;
}

/**
 * Features to apply, in declaration order: the defaults and the ones switched on (plus everything they require),
 * minus the ones switched off. `choice` maps a feature to true (on) or false (off). Throws on unknown names, on
 * conflicts, and when a feature switched off is required by one that is on.
 */
export function selectFeatures(features: FeatureRule[], choice: Record<string, boolean>, owner: string): string[] {
  const byName = new Map(features.map((feature) => [feature.name, feature]));
  const unknown = Object.keys(choice).filter((name) => !byName.has(name));
  if (unknown.length)
    fail(
      `${owner} no tiene la feature ${unknown.map((name) => `"${name}"`).join(", ")}.${features.length ? ` Disponibles: ${features.map((feature) => feature.name).join(", ")}.` : " No declara features."}`,
    );
  const off = new Set(
    Object.entries(choice)
      .filter(([, value]) => !value)
      .map(([name]) => name),
  );
  const on = new Set<string>();
  const add = (name: string, because?: string) => {
    if (off.has(name))
      fail(
        `${owner}: no se puede quitar "${name}" porque ${because ? `"${because}" la requiere` : "también la pides"}`,
      );
    if (on.has(name)) return;
    on.add(name);
    for (const required of byName.get(name)!.requires) add(required, name);
  };
  for (const feature of features) if (feature.default && !off.has(feature.name)) add(feature.name);
  for (const [name, value] of Object.entries(choice)) if (value) add(name);
  for (const name of on)
    for (const other of byName.get(name)!.conflicts)
      if (on.has(other))
        fail(
          `${owner}: "${name}" y "${other}" no se pueden combinar${byName.get(other)!.default ? ` (quita la que viene por defecto con --no-${other})` : ""}`,
        );
  return features.map((feature) => feature.name).filter((name) => on.has(name));
}

/**
 * Reads feature flags: `--name` switches a feature on and `--no-name` off. Returns the choice and any token that is
 * not a feature flag, so the caller can report it with the options that are available.
 */
export function parseFeatureFlags(
  tokens: string[],
  names?: string[],
): { choice: Record<string, boolean>; unknown: string[] } {
  const choice: Record<string, boolean> = {};
  const unknown: string[] = [];
  for (const token of tokens) {
    const match = /^--(no-)?([a-z][a-z0-9-]*)$/.exec(token);
    if (!match) {
      unknown.push(token);
      continue;
    }
    const [, negated, name] = match;
    if (names && !names.includes(name)) {
      unknown.push(token);
      continue;
    }
    choice[name] = !negated;
  }
  return { choice, unknown };
}

/** "¿Quisiste decir…?" hint for an unknown flag. */
export function suggestFeature(token: string, names: string[]): string | undefined {
  const key = token.replace(/^--(no-)?/, "");
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const current = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length]!;
  };
  const best = names
    .map((name) => ({ name, score: name.startsWith(key) || key.startsWith(name) ? 0 : distance(key, name) }))
    .sort((a, b) => a.score - b.score)[0];
  return best && best.score <= Math.max(2, Math.floor(best.name.length / 3)) ? best.name : undefined;
}

/** Help lines for a set of features: the flag to use and what it does. `active` marks the ones currently on. */
export function featureHelpLines(features: Array<FeatureRule & { notes?: string[] }>, active?: string[]): string[] {
  const rows = features.map((feature) => {
    const notes = [
      feature.default ? "activada por defecto" : "",
      feature.requires.length ? `requiere ${feature.requires.join(", ")}` : "",
      feature.conflicts.length ? `no combina con ${feature.conflicts.join(", ")}` : "",
      ...(feature.notes ?? []),
      active ? (active.includes(feature.name) ? "ACTIVA" : "inactiva") : "",
    ].filter(Boolean);
    const flag = feature.default && !active ? `--${feature.name} / --no-${feature.name}` : `--${feature.name}`;
    return [flag, `${feature.description}${notes.length ? ` (${notes.join("; ")})` : ""}`] as const;
  });
  const width = Math.max(0, ...rows.map(([flag]) => flag.length));
  return rows.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`);
}
