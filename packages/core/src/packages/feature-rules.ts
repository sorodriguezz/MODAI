import { AppError } from "@modai/contracts/errors";

export interface FeatureRule {
  name: string;
  description: string;
  default: boolean;
  requires: string[];
  conflicts: string[];
}

export const FEATURE_NAME = /^[a-z][a-z0-9-]{0,39}$/;
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

export function featureNameProblem(name: string): string {
  if (!FEATURE_NAME.test(name))
    return `"${name}" no es un nombre de feature válido: minúsculas, números y guiones, empezando por letra (por ejemplo "x-lib")`;
  if (name.startsWith("no-")) return `"${name}" empieza por "no-", que se usa para apagar features (--no-<nombre>)`;
  if (RESERVED_FEATURE_NAMES.has(name)) return `"${name}" está reservado para una opción de la CLI`;
  return "";
}

const invalidFeature = (message: string) => new AppError(400, "INVALID_FEATURE", message);
const fail = (message: string): never => {
  throw new AppError(422, "FEATURE_SELECTION", message);
};

function assertFeatureReferences(feature: FeatureRule, names: Set<string>, owner: string): void {
  const problem = featureNameProblem(feature.name);
  if (problem) throw invalidFeature(`${owner}: ${problem}`);
  for (const ref of [...feature.requires, ...feature.conflicts])
    if (!names.has(ref))
      throw invalidFeature(`${owner}: la feature "${feature.name}" menciona "${ref}", que no está declarada`);
  if (feature.requires.includes(feature.name) || feature.conflicts.includes(feature.name))
    throw invalidFeature(`${owner}: "${feature.name}" no puede requerirse ni oponerse a sí misma`);
  for (const required of feature.requires)
    if (feature.conflicts.includes(required))
      throw invalidFeature(`${owner}: "${feature.name}" requiere y a la vez se opone a "${required}"`);
}

function assertNoRequiresCycle(features: FeatureRule[], byName: Map<string, FeatureRule>, owner: string): void {
  const done = new Set<string>();
  const visit = (name: string, chain: string[]) => {
    if (chain.includes(name))
      throw invalidFeature(`${owner}: "requires" forma un ciclo (${[...chain, name].join(" → ")})`);
    if (done.has(name)) return;
    for (const required of byName.get(name)?.requires ?? []) visit(required, [...chain, name]);
    done.add(name);
  };
  for (const feature of features) visit(feature.name, []);
}

function assertSelectable(features: FeatureRule[], byName: Map<string, FeatureRule>, owner: string): void {
  for (const feature of features) {
    const closure = requiresClosure(features, feature.name);
    for (const name of closure) {
      const other = byName.get(name)!.conflicts.find((conflict) => closure.includes(conflict));
      if (other)
        throw invalidFeature(
          `${owner}: "${feature.name}" no se puede activar nunca: trae "${name}" y "${other}", que no se combinan`,
        );
    }
  }
}

export function assertFeatureRules(features: FeatureRule[], owner: string): void {
  const names = new Set(features.map((feature) => feature.name));
  for (const feature of features) assertFeatureReferences(feature, names, owner);
  const byName = new Map(features.map((feature) => [feature.name, feature]));
  assertNoRequiresCycle(features, byName, owner);
  assertSelectable(features, byName, owner);
  try {
    selectFeatures(features, {}, owner);
  } catch (error) {
    throw invalidFeature((error as Error).message);
  }
}

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

function assertKnownChoices(features: FeatureRule[], choice: Record<string, boolean>, owner: string): void {
  const known = new Set(features.map((feature) => feature.name));
  const unknown = Object.keys(choice).filter((name) => !known.has(name));
  if (!unknown.length) return;
  const available = features.length
    ? ` Disponibles: ${features.map((feature) => feature.name).join(", ")}.`
    : " No declara features.";
  fail(`${owner} no tiene la feature ${unknown.map((name) => `"${name}"`).join(", ")}.${available}`);
}

function assertNoConflicts(on: Set<string>, byName: Map<string, FeatureRule>, owner: string): void {
  for (const name of on)
    for (const other of byName.get(name)!.conflicts) {
      if (!on.has(other)) continue;
      const hint = byName.get(other)!.default ? ` (quita la que viene por defecto con --no-${other})` : "";
      fail(`${owner}: "${name}" y "${other}" no se pueden combinar${hint}`);
    }
}

export function selectFeatures(features: FeatureRule[], choice: Record<string, boolean>, owner: string): string[] {
  assertKnownChoices(features, choice, owner);
  const byName = new Map(features.map((feature) => [feature.name, feature]));
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
  assertNoConflicts(on, byName, owner);
  return features.map((feature) => feature.name).filter((name) => on.has(name));
}
