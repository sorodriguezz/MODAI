import type { FeatureRule } from "./feature-rules.js";

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

function editDistance(a: string, b: string): number {
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
}

export function suggestFeature(token: string, names: string[]): string | undefined {
  const key = token.replace(/^--(no-)?/, "");
  const best = names
    .map((name) => ({ name, score: name.startsWith(key) || key.startsWith(name) ? 0 : editDistance(key, name) }))
    .sort((a, b) => a.score - b.score)[0];
  return best && best.score <= Math.max(2, Math.floor(best.name.length / 3)) ? best.name : undefined;
}

type HelpFeature = FeatureRule & { notes?: string[] };

function activityNote(feature: HelpFeature, active?: string[]): string {
  if (!active) return "";
  return active.includes(feature.name) ? "ACTIVA" : "inactiva";
}

function featureHelpRow(feature: HelpFeature, active?: string[]): readonly [string, string] {
  const notes = [
    feature.default ? "activada por defecto" : "",
    feature.requires.length ? `requiere ${feature.requires.join(", ")}` : "",
    feature.conflicts.length ? `no combina con ${feature.conflicts.join(", ")}` : "",
    ...(feature.notes ?? []),
    activityNote(feature, active),
  ].filter(Boolean);
  const flag = feature.default && !active ? `--${feature.name} / --no-${feature.name}` : `--${feature.name}`;
  return [flag, `${feature.description}${notes.length ? ` (${notes.join("; ")})` : ""}`] as const;
}

export function featureHelpLines(features: HelpFeature[], active?: string[]): string[] {
  const rows = features.map((feature) => featureHelpRow(feature, active));
  const width = Math.max(0, ...rows.map(([flag]) => flag.length));
  return rows.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`);
}
