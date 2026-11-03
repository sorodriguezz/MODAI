import YAML from "yaml";
import type { QualityFinding } from "../types.js";

function frontmatter(content: string): Record<string, unknown> | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  try {
    return YAML.parse(match[1]) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function discoveryScore(metadata: Record<string, unknown> | undefined, findings: QualityFinding[], label: string) {
  let discovery = 0;
  if (typeof metadata?.name === "string" && /^[a-z0-9-]{1,64}$/.test(metadata.name)) discovery += 50;
  else
    findings.push({
      severity: "error",
      code: "SKILL_NAME_INVALID",
      message: `${label}SKILL.md necesita un name corto en minúsculas y guiones.`,
    });
  const description = metadata?.description;
  if (typeof description === "string" && description.length >= 30 && description.length <= 400) discovery += 50;
  else
    findings.push({
      severity: "warning",
      code: "SKILL_DESCRIPTION_WEAK",
      message: `${label}La descripción debe explicar capacidad, activación y límites con precisión.`,
    });
  return discovery;
}

function instructionsScore(bodyLength: number): number {
  if (bodyLength >= 250 && bodyLength <= 12_000) return 100;
  return bodyLength > 0 ? 50 : 0;
}

function progressiveScore(hasReferences: boolean, bodyLength: number): number {
  if (hasReferences) return 100;
  return bodyLength < 4_000 ? 80 : 30;
}

export function analyzeSkill(
  skill: string,
  hasReferences: boolean,
  findings: QualityFinding[],
  dimensions: Record<string, number>,
  label = "",
): void {
  const discovery = discoveryScore(frontmatter(skill), findings, label);
  const body = skill.replace(/^---[\s\S]*?---/, "").trim();
  const instructions = instructionsScore(body.length);
  if (body.length > 12_000)
    findings.push({
      severity: "warning",
      code: "SKILL_TOO_LARGE",
      message: `${label}Mueve detalle condicional a references/ para reducir el contexto inicial.`,
    });
  const progressive = progressiveScore(hasReferences, body.length);
  const safety = /(alcance|scope|no (?:hagas|modifiques)|autorizaci|destructiv|permiso)/i.test(skill) ? 100 : 60;
  const validation = /(verifica|validaci|prueba|test|evidencia|criterio)/i.test(skill) ? 100 : 40;
  if (validation < 60)
    findings.push({
      severity: "warning",
      code: "SKILL_NO_VALIDATION",
      message: `${label}Define evidencia observable o comandos de verificación relevantes.`,
    });
  const merge = (key: string, value: number) => {
    dimensions[key] = key in dimensions ? Math.min(dimensions[key], value) : value;
  };
  merge("discovery", discovery);
  merge("instructions", instructions);
  merge("progressiveDisclosure", progressive);
  merge("safety", safety);
  merge("validation", validation);
}
